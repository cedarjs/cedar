/* eslint-env node */
// @ts-check

import fs from 'node:fs'
import path from 'node:path'

import { CEDAR_FRAMEWORK_PATH } from '../actionsLib.mjs'

const PRISMA_CONFIG_CJS_CONTENT = `const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
`

const PRISMA_SCHEMA_GENERATOR_OLD = /generator client \{[^}]*\}/s

const PRISMA_SCHEMA_GENERATOR_NEW = `generator client {
  provider               = "prisma-client"
  output                 = "./generated/prisma"
  moduleFormat           = "cjs"
  generatedFileExtension = "mts"
  importFileExtension    = "mts"
}`

/**
 * @typedef {import('@actions/exec').ExecOptions} ExecOptions
 */

/**
 * Exec a command.
 * Output will be streamed to the live console.
 * Returns promise with return code
 *
 * @callback Exec
 * @param {string} commandLine command to execute (can include additional args). Must be correctly escaped.
 * @param {string[]=} args arguments for tool. Escaping is handled by the lib.
 * @param {ExecOptions=} options exec options.  See ExecOptions
 * @returns {Promise<unknown>} exit code
 */

/**
 * @callback ExecInProject
 * @param {string} commandLine command to execute (can include additional args). Must be correctly escaped.
 * @param {Omit<ExecOptions, "cwd">=} options exec options.  See ExecOptions
 * @returns {Promise<unknown>} exit code
 */

/**
 * @param {string} rscProjectPath
 * @param {Object} core
 * @param {(key: string, value: string) => void} core.setOutput
 * @param {Exec} exec
 * @param {ExecInProject} execInProject
 * @returns {Promise<void>}
 */
export async function main(rscProjectPath, core, exec, execInProject) {
  core.setOutput('rsc-project-path', rscProjectPath)

  console.log('Cedar Framework Path', CEDAR_FRAMEWORK_PATH)
  console.log('rscProjectPath', rscProjectPath)

  await setUpRscProject(rscProjectPath, exec, execInProject)
}

/**
 * @param {string} rscProjectPath
 * @param {Exec} exec
 * @param {ExecInProject} execInProject
 * @returns {Promise<void>}
 */
async function setUpRscProject(rscProjectPath, exec, execInProject) {
  const cedarBinPath = path.join(
    CEDAR_FRAMEWORK_PATH,
    'packages/cli/dist/index.js',
  )

  console.log(`Creating project at ${rscProjectPath}`)
  console.log()
  await exec('npx', [
    '-y',
    'create-cedar-app@canary',
    '-y',
    '--no-git',
    '--no-node-check',
    rscProjectPath,
  ])
  await execInProject('yarn install')
  await execInProject('yarn cedar upgrade --yes --tag canary')

  console.log(`Setting up Streaming/SSR in ${rscProjectPath}`)
  const cmdSetupStreamingSSR = `node ${cedarBinPath} experimental setup-streaming-ssr -f`
  await execInProject(cmdSetupStreamingSSR)
  console.log()

  console.log(`Setting up RSC in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} experimental setup-rsc`)
  console.log()

  console.log('Syncing framework')
  // TODO: hard code this to just be `yarn cfw proje...` as soon as cfw is part
  // of a stable Cedar release
  const cfwBin = fs.existsSync(
    path.join(rscProjectPath, 'node_modules/.bin/cfw'),
  )
    ? 'cfw'
    : 'rwfw'
  await execInProject(`yarn ${cfwBin} project:tarsync --verbose`, {
    env: {
      CFW_PATH: CEDAR_FRAMEWORK_PATH,
      RWFW_PATH: CEDAR_FRAMEWORK_PATH,
    },
  })
  console.log()

  console.log('Updating project for Prisma v7 compatibility')
  updateProjectForPrisma7(rscProjectPath)
  console.log()

  console.log(`Building project in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} build -v`)
  console.log()
}

/**
 * @param {string} rscProjectPath
 * @returns {void}
 */
function updateProjectForPrisma7(rscProjectPath) {
  // Replace prisma.config.cjs with Prisma v7 format
  const prismaConfigPath = path.join(rscProjectPath, 'api', 'prisma.config.cjs')
  fs.writeFileSync(prismaConfigPath, PRISMA_CONFIG_CJS_CONTENT, 'utf8')
  console.log('  Updated api/prisma.config.cjs')

  // Update schema.prisma generator block to Prisma v7 format
  const schemaPath = path.join(rscProjectPath, 'api', 'db', 'schema.prisma')
  const schemaContent = fs.readFileSync(schemaPath, 'utf8')
  const updatedSchema = schemaContent.replace(
    PRISMA_SCHEMA_GENERATOR_OLD,
    PRISMA_SCHEMA_GENERATOR_NEW,
  )
  fs.writeFileSync(schemaPath, updatedSchema, 'utf8')
  console.log('  Updated api/db/schema.prisma')

  // Update api/tsconfig.json for Prisma v7 / Node16 module resolution
  const apiTsconfigPath = path.join(rscProjectPath, 'api', 'tsconfig.json')
  const apiTsconfig = JSON.parse(fs.readFileSync(apiTsconfigPath, 'utf8'))

  apiTsconfig.compilerOptions.target = 'es2023'
  apiTsconfig.compilerOptions.module = 'node20'
  apiTsconfig.compilerOptions.moduleResolution = 'node16'
  apiTsconfig.compilerOptions.allowImportingTsExtensions = true

  fs.writeFileSync(
    apiTsconfigPath,
    JSON.stringify(apiTsconfig, null, 2) + '\n',
    'utf8',
  )

  console.log('  Updated api/tsconfig.json')

  // Update scripts/tsconfig.json for Prisma v7 / Node16 module resolution
  const scriptsTsconfigPath = path.join(
    rscProjectPath,
    'scripts',
    'tsconfig.json',
  )

  if (fs.existsSync(scriptsTsconfigPath)) {
    const scriptsTsconfig = JSON.parse(
      fs.readFileSync(scriptsTsconfigPath, 'utf8'),
    )

    scriptsTsconfig.compilerOptions.target = 'es2023'
    scriptsTsconfig.compilerOptions.module = 'node20'
    scriptsTsconfig.compilerOptions.moduleResolution = 'node16'
    scriptsTsconfig.compilerOptions.allowImportingTsExtensions = true

    fs.writeFileSync(
      scriptsTsconfigPath,
      JSON.stringify(scriptsTsconfig, null, 2) + '\n',
      'utf8',
    )

    console.log('  Updated scripts/tsconfig.json')
  }
}
