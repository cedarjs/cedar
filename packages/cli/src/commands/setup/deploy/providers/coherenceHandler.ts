import fs from 'node:fs'
import path from 'path'

import prismaInternals from '@prisma/internals'
import { Listr } from 'listr2'
import * as toml from 'smol-toml'

import {
  colors as c,
  isTypeScriptProject,
  getConfigPath,
} from '@cedarjs/cli-helpers'
import {
  formatCedarCommand,
  formatRunBinCommand,
} from '@cedarjs/cli-helpers/packageManager/display'
import { getPaths, getPrismaSchemas } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { printSetupNotes } from '../../../../lib/index.js'
import { serverFileExists } from '../../../../lib/project.js'
import { addFilesTask } from '../helpers/index.js'

const { getConfig } = prismaInternals
const cedarPaths = getPaths()

const EXTENSION = isTypeScriptProject ? 'ts' : 'js'

export async function handler({ force }: { force: boolean }) {
  try {
    const addCoherenceFilesTask = await getAddCoherenceFilesTask(force)

    const tasks = new Listr(
      [
        addCoherenceFilesTask,
        updateConfigTomlTask(),
        printSetupNotes([
          "You're ready to deploy to Coherence! ✨\n",
          'Go to https://app.withcoherence.com to create your account and setup your cloud or GitHub connections.',
          'Check out the deployment docs at https://docs.withcoherence.com for detailed instructions and more information.\n',
          "Reach out to cedar@withcoherence.com with any questions! We're here to support you.",
        ]),
      ],
      { rendererOptions: { collapse: false } },
    )

    await tasks.run()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}

// ------------------------
// Tasks and helpers
// ------------------------

/**
 * Adds a health check file and a coherence.yml file by introspecting the prisma schema.
 */
async function getAddCoherenceFilesTask(force: boolean) {
  const files: { path: string; content: string }[] = [
    {
      path: path.join(cedarPaths.api.functions, `health.${EXTENSION}`),
      content: coherenceFiles.healthCheck,
    },
  ]

  const coherenceConfigContent = await getCoherenceConfigFileContent()
  files.push({
    path: path.join(cedarPaths.base, 'coherence.yml'),
    content: coherenceConfigContent,
  })

  return addFilesTask({
    title: `Adding coherence.yml and health.${EXTENSION}`,
    files,
    force,
  })
}

/**
 * Check the value of `provider` in the datasource block in `schema.prisma`:
 */
async function getCoherenceConfigFileContent(): Promise<string> {
  const result = await getPrismaSchemas()
  const prismaConfig = await getConfig({ datamodel: result.schemas })

  let db = prismaConfig.datasources[0].activeProvider

  if (!SUPPORTED_DATABASES.includes(db)) {
    throw new Error(
      [
        `Coherence doesn't support the "${db}" provider in your Prisma schema.`,
        `To proceed, switch to one of the following: ${SUPPORTED_DATABASES.join(
          ', ',
        )}.`,
      ].join('\n'),
    )
  }

  if (db === 'postgresql') {
    db = 'postgres'
  }

  const apiProdCommandSegments = [formatCedarCommand(['build', 'api']), '&&']
  if (serverFileExists()) {
    apiProdCommandSegments.push(
      formatRunBinCommand('node', ['api/dist/server.js', '--apiRootPath=/api']),
    )
  } else {
    apiProdCommandSegments.push(
      formatCedarCommand(['serve', 'api', '--apiRootPath=/api']),
    )
  }

  const apiDevCommandSegments = [
    formatCedarCommand(['build', 'api']),
    '&&',
    formatCedarCommand(['dev', 'api', '--apiRootPath=/api']),
  ]

  const migrationCommandSegments = [
    formatCedarCommand(['prisma', 'migrate', 'deploy']),
    '&&',
    formatCedarCommand(['data-migrate', 'up']),
  ]

  return coherenceFiles.yamlTemplate({
    db,
    apiProdCommand: `[${apiProdCommandSegments.map((cmd) => `"${cmd}"`).join(', ')}]`,
    apiDevCommand: `[${apiDevCommandSegments.map((cmd) => `"${cmd}"`).join(', ')}]`,
    migrationCommand: `[${migrationCommandSegments.map((cmd) => `"${cmd}"`).join(', ')}]`,
    webProdCommand: `["${formatCedarCommand(['serve', 'web'])}"]`,
    webDevCommand: `["${formatCedarCommand(['dev', 'web', '--fwd=\\"--allowed-hosts all\\"'])}"]`,
    webBuildCommand: `["${formatCedarCommand(['build', 'web', '--no-prerender'])}"]`,
  })
}

const SUPPORTED_DATABASES = ['mysql', 'postgresql']

function updateConfigTomlTask() {
  const configTomlPath = getConfigPath()
  const configFileName = path.basename(configTomlPath)

  return {
    title: `Updating ${configFileName}...`,
    task: () => {
      let configContent = fs.readFileSync(configTomlPath, 'utf-8')
      const configObject = toml.parse(configContent) as {
        web: { host?: string }
        api: { host?: string }
      }

      if (!configObject.web.host) {
        const [beforeWeb, afterWeb] = configContent.split(/\[web\]\s/)
        configContent = [
          beforeWeb,
          '[web]\n  host = "0.0.0.0"\n',
          afterWeb,
        ].join('')
      }

      if (!configObject.api.host) {
        const [beforeApi, afterApi] = configContent.split(/\[api\]\s/)
        configContent = [
          beforeApi,
          '[api]\n  host = "0.0.0.0"\n',
          afterApi,
        ].join('')
      }

      configContent = configContent.replaceAll(
        HOST_REGEXP,
        (_match: string, spaceBeforeAssign: string, spaceAfterAssign: string) =>
          ['host', spaceBeforeAssign, '=', spaceAfterAssign, '"0.0.0.0"'].join(
            '',
          ),
      )

      configContent = configContent.replace(
        API_URL_REGEXP,
        (_match: string, spaceBeforeAssign: string, spaceAfterAssign: string) =>
          ['apiUrl', spaceBeforeAssign, '=', spaceAfterAssign, '"/api"'].join(
            '',
          ),
      )

      configContent = configContent.replaceAll(
        PORT_REGEXP,
        (
          _match: string,
          spaceBeforeAssign: string,
          spaceAfterAssign: string,
          port: string,
        ) =>
          [
            'port',
            spaceBeforeAssign,
            '=',
            spaceAfterAssign,
            `"\${PORT:${port}}"`,
          ].join(''),
      )

      fs.writeFileSync(configTomlPath, configContent)
    },
  }
}

const HOST_REGEXP = /host(\s*)=(\s*)\".+\"/g
const API_URL_REGEXP = /apiUrl(\s*)=(\s*)\".+\"/
const PORT_REGEXP = /port(\s*)=(\s*)(?<port>\d{4})/g

// ------------------------
// Files
// ------------------------

interface YamlTemplateArgs {
  db: string
  apiProdCommand: string
  apiDevCommand: string
  migrationCommand: string
  webProdCommand: string
  webDevCommand: string
  webBuildCommand: string
}

const coherenceFiles = {
  yamlTemplate({
    db,
    apiProdCommand,
    apiDevCommand,
    migrationCommand,
    webProdCommand,
    webDevCommand,
    webBuildCommand,
  }: YamlTemplateArgs): string {
    return `\
api:
  type: backend
  url_path: "/api"
  prod:
    command: ${apiProdCommand}
  dev:
    command: ${apiDevCommand}
  local_packages: ["node_modules"]

  system:
    cpu: 2
    memory: 2G
    health_check: "/api/health"

  resources:
    - name: ${path.basename(cedarPaths.base)}-db
      engine: ${db}
      version: 13
      type: database
      ${db === 'postgres' ? 'adapter: postgresql' : ''}

  # If you use data migrations, use the following instead:
  # migration: ["${formatCedarCommand(['prisma', 'migrate', 'deploy'])}", "&&", "${formatCedarCommand(['data-migrate', 'up'])}"]
  migration: ${migrationCommand}

web:
  type: frontend
  assets_path: "web/dist"
  prod:
    command: ${webProdCommand}
  dev:
    command: ${webDevCommand}

  # Heads up: Redwood's prerender doesn't work with Coherence yet.
  # For current status and updates, see https://github.com/redwoodjs/redwood/issues/8333.
  build: ${webBuildCommand}
  local_packages: ["node_modules"]

  system:
    cpu: 2
    memory: 2G
`
  },
  healthCheck: `\
// Coherence health check
export const handler = async () => {
  return {
    statusCode: 200,
  }
}
`,
}
