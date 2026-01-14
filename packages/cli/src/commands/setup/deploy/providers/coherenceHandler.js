import fs from 'node:fs'
import path from 'path'

import prismaInternals from '@prisma/internals'
import { Listr } from 'listr2'
import * as toml from 'smol-toml'

import {
  colors as c,
  getPaths,
  isTypeScriptProject,
  getConfigPath,
} from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { printSetupNotes } from '../../../../lib/index.js'
import { serverFileExists } from '../../../../lib/project.js'
import { addFilesTask } from '../helpers/index.js'

const { getSchemaWithPath, getConfig } = prismaInternals
const cedarPaths = getPaths()

const EXTENSION = isTypeScriptProject ? 'ts' : 'js'

export async function handler({ force }) {
  try {
    const addCoherenceFilesTask = await getAddCoherenceFilesTask(force)

    const tasks = new Listr(
      [
        addCoherenceFilesTask,
        updateConfigTask(),
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
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}

// ------------------------
// Tasks and helpers
// ------------------------

/**
 * Adds a health check file and a coherence.yml file by introspecting the prisma schema.
 */
async function getAddCoherenceFilesTask(force) {
  const files = [
    {
      path: path.join(cedarPaths.api.functions, `health.${EXTENSION}`),
      content: coherenceFiles.healthCheck,
    },
  ]

  const coherenceConfigFile = {
    path: path.join(cedarPaths.base, 'coherence.yml'),
  }

  coherenceConfigFile.content = await getCoherenceConfigFileContent()

  files.push(coherenceConfigFile)

  return addFilesTask({
    title: `Adding coherence.yml and health.${EXTENSION}`,
    files,
    force,
  })
}

/**
 * Check the value of `provider` in the datasource block in `schema.prisma`:
 *
 * ```prisma title="schema.prisma"
 * datasource db {
 *   provider = "sqlite"
 *   url      = env("DATABASE_URL")
 * }
 * ```
 */
async function getCoherenceConfigFileContent() {
  const result = await getSchemaWithPath(cedarPaths.api.dbSchema)
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

  const apiProdCommand = ['yarn', 'cedar', 'build', 'api', '&&']
  if (serverFileExists()) {
    apiProdCommand.push(
      'yarn',
      'node',
      'api/dist/server.js',
      '--apiRootPath=/api',
    )
  } else {
    apiProdCommand.push('yarn', 'cedar', 'serve', 'api', '--apiRootPath=/api')
  }

  return coherenceFiles.yamlTemplate({
    db,
    apiProdCommand: `[${apiProdCommand.map((cmd) => `"${cmd}"`).join(', ')}]`,
  })
}

const SUPPORTED_DATABASES = ['mysql', 'postgresql']

/**
 * should probably parse toml at this point...
 * if host, set host
 * Updates the ports in your configuration file to use an environment variable.
 */
function updateConfigTask() {
  return {
    title: 'Updating configuration file...',
    task: () => {
      const configPath = getConfigPath()
      let configContent = fs.readFileSync(configPath, 'utf-8')
      const configObject = toml.parse(configContent)

      // Replace or add the host
      // How to handle matching one vs the other...
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
        (match, spaceBeforeAssign, spaceAfterAssign) =>
          ['host', spaceBeforeAssign, '=', spaceAfterAssign, '"0.0.0.0"'].join(
            '',
          ),
      )

      // Replace the apiUrl
      configContent = configContent.replace(
        API_URL_REGEXP,
        (match, spaceBeforeAssign, spaceAfterAssign) =>
          ['apiUrl', spaceBeforeAssign, '=', spaceAfterAssign, '"/api"'].join(
            '',
          ),
      )

      // Replace the web and api ports.
      configContent = configContent.replaceAll(
        PORT_REGEXP,
        (_match, spaceBeforeAssign, spaceAfterAssign, port) =>
          [
            'port',
            spaceBeforeAssign,
            '=',
            spaceAfterAssign,
            `"\${PORT:${port}}"`,
          ].join(''),
      )

      fs.writeFileSync(configPath, configContent)
    },
  }
}

const HOST_REGEXP = /host(\s*)=(\s*)\".+\"/g
const API_URL_REGEXP = /apiUrl(\s*)=(\s*)\".+\"/
const PORT_REGEXP = /port(\s*)=(\s*)(?<port>\d{4})/g

// ------------------------
// Files
// ------------------------

const coherenceFiles = {
  yamlTemplate({ db, apiProdCommand }) {
    return `\
api:
  type: backend
  url_path: "/api"
  prod:
    command: ${apiProdCommand}
  dev:
    command: ["yarn", "rw", "build", "api", "&&", "yarn", "rw", "dev", "api", "--apiRootPath=/api"]
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
  # migration: ["yarn", "rw", "prisma", "migrate", "deploy", "&&", "yarn", "rw", "data-migrate", "up"]
  migration: ["yarn", "rw", "prisma", "migrate", "deploy"]

web:
  type: frontend
  assets_path: "web/dist"
  prod:
    command: ["yarn", "rw", "serve", "web"]
  dev:
    command: ["yarn", "rw", "dev", "web", "--fwd=\\"--allowed-hosts all\\""]

  # Heads up: Redwood's prerender doesn't work with Coherence yet.
  # For current status and updates, see https://github.com/redwoodjs/redwood/issues/8333.
  build: ["yarn", "rw", "build", "web", "--no-prerender"]
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
