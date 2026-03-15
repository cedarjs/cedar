/* eslint-env node */
// @ts-check

import fs from 'node:fs'
import path from 'node:path'

import { CEDAR_FRAMEWORK_PATH } from '../actionsLib.mjs'

const CEDAR_APP_TEMPLATE_PATH = path.join(
  CEDAR_FRAMEWORK_PATH,
  'packages',
  'create-cedar-app',
  'templates',
  'ts',
)

const PRISMA_SCHEMA_DATASOURCE_URL_OLD = /^\s*url\s*=\s*env\([^)]*\)\s*\n/m

const CEDAR_APP_TEMPLATE_API_PACKAGE_JSON_PATH = path.join(
  CEDAR_APP_TEMPLATE_PATH,
  'api',
  'package.json',
)

const PRISMA_SCHEMA_GENERATOR_OLD = /generator client \{[^}]*\}/s

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

  // TODO: Remove this block once Prisma v7 support has been merged into a
  // canary release of create-cedar-app, at which point the created project
  // will already be Prisma v7 compatible.
  console.log('Updating project for Prisma v7 compatibility')
  updateProjectForPrisma7(rscProjectPath)
  console.log()

  console.log('Installing new Prisma v7 dependencies')
  await execInProject('yarn install')
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
  // Copy prisma.config.cjs from template (Prisma v7 format)
  const prismaConfigPath = path.join(rscProjectPath, 'api', 'prisma.config.cjs')
  fs.copyFileSync(
    path.join(CEDAR_APP_TEMPLATE_PATH, 'api', 'prisma.config.cjs'),
    prismaConfigPath,
  )
  console.log('  Updated api/prisma.config.cjs')

  // Update schema.prisma: remove datasource url line and replace generator block
  // (Can't copy the template wholesale because the project has extra models from
  // the RSC setup steps.)
  const schemaPath = path.join(rscProjectPath, 'api', 'db', 'schema.prisma')
  const templateSchema = fs.readFileSync(
    path.join(CEDAR_APP_TEMPLATE_PATH, 'api', 'db', 'schema.prisma'),
    'utf8',
  )
  const generatorMatch = templateSchema.match(PRISMA_SCHEMA_GENERATOR_OLD)
  const templateGenerator = generatorMatch ? generatorMatch[0] : null
  if (!templateGenerator) {
    throw new Error('Could not find generator block in template schema.prisma')
  }
  const schemaContent = fs.readFileSync(schemaPath, 'utf8')
  const updatedSchema = schemaContent
    .replace(PRISMA_SCHEMA_DATASOURCE_URL_OLD, '')
    .replace(PRISMA_SCHEMA_GENERATOR_OLD, templateGenerator)
  fs.writeFileSync(schemaPath, updatedSchema, 'utf8')
  console.log('  Updated api/db/schema.prisma')

  // Copy api/src/lib/db.ts from template (Prisma v7 client initialisation)
  const dbTsPath = path.join(rscProjectPath, 'api', 'src', 'lib', 'db.ts')
  fs.copyFileSync(
    path.join(CEDAR_APP_TEMPLATE_PATH, 'api', 'src', 'lib', 'db.ts'),
    dbTsPath,
  )
  console.log('  Updated api/src/lib/db.ts')

  // Copy api/tsconfig.json from template (Prisma v7 / Node16 module resolution)
  const apiTsconfigPath = path.join(rscProjectPath, 'api', 'tsconfig.json')
  fs.copyFileSync(
    path.join(CEDAR_APP_TEMPLATE_PATH, 'api', 'tsconfig.json'),
    apiTsconfigPath,
  )
  console.log('  Updated api/tsconfig.json')

  // Merge @prisma/adapter-better-sqlite3 and better-sqlite3 from template into
  // api/package.json (the canary-generated project won't have these deps)
  const apiPackageJsonPath = path.join(rscProjectPath, 'api', 'package.json')
  const apiPackageJson = JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf8'))
  const templateApiPackageJson = JSON.parse(
    fs.readFileSync(CEDAR_APP_TEMPLATE_API_PACKAGE_JSON_PATH, 'utf8'),
  )
  const depsToAdd = ['@prisma/adapter-better-sqlite3', 'better-sqlite3']
  for (const dep of depsToAdd) {
    apiPackageJson.dependencies[dep] = templateApiPackageJson.dependencies[dep]
  }
  fs.writeFileSync(
    apiPackageJsonPath,
    JSON.stringify(apiPackageJson, null, 2) + '\n',
    'utf8',
  )
  console.log('  Updated api/package.json')

  // Copy scripts/tsconfig.json from template (Prisma v7 / Node16 module resolution)
  const scriptsTsconfigPath = path.join(
    rscProjectPath,
    'scripts',
    'tsconfig.json',
  )
  if (fs.existsSync(scriptsTsconfigPath)) {
    fs.copyFileSync(
      path.join(CEDAR_APP_TEMPLATE_PATH, 'scripts', 'tsconfig.json'),
      scriptsTsconfigPath,
    )
    console.log('  Updated scripts/tsconfig.json')
  }
}
