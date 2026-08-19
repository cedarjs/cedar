// @ts-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getExecOutput } from '@actions/exec'

/**
 * @typedef {import('@actions/exec').ExecOptions} ExecOptions
 */

export const CEDAR_FRAMEWORK_PATH = fileURLToPath(
  new URL('../../', import.meta.url),
)

/**
 * @param {string} command
 * @param {ExecOptions} options
 */
function execWithEnv(command, { env = {}, ...rest } = {}) {
  /** @type {{ [key: string]: string }} */
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      /** @returns {entry is [string, string]} */
      (entry) => entry[1] !== undefined,
    ),
  )

  return getExecOutput(command, undefined, {
    env: {
      ...processEnv,
      ...env,
    },
    ...rest,
  })
}

/**
 * @param {string} cwd
 */
export function createExecWithEnvInCwd(cwd) {
  /**
   * @param {string} command
   * @param {Omit<ExecOptions, 'cwd'>} options
   */
  return function (command, options = {}) {
    return execWithEnv(command, { cwd, ...options })
  }
}

export const execInFramework = createExecWithEnvInCwd(CEDAR_FRAMEWORK_PATH)

/**
 * @callback ExecInProject
 * @param {string} commandLine command to execute (can include additional args). Must be correctly escaped.
 * @param {Omit<ExecOptions, "cwd">=} options exec options.  See ExecOptions
 * @returns {Promise<unknown>} exit code
 */

/**
 * @param {string} testProjectPath
 * @param {string} fixtureName
 * @param {Object} core
 * @param {(key: string, value: string) => void} core.setOutput
 * @param {ExecInProject} execInProject
 * @returns {Promise<void>}
 */
export async function setUpRscTestProject(
  testProjectPath,
  fixtureName,
  core,
  execInProject,
) {
  core.setOutput('test-project-path', testProjectPath)

  console.log('Cedar Framework Path', CEDAR_FRAMEWORK_PATH)
  console.log('testProjectPath', testProjectPath)

  const fixturePath = path.join(
    CEDAR_FRAMEWORK_PATH,
    '__fixtures__',
    fixtureName,
  )
  const cedarBinPath = path.join(
    CEDAR_FRAMEWORK_PATH,
    'packages/cli/dist/index.js',
  )
  const cfwBinPath = path.join(CEDAR_FRAMEWORK_PATH, 'packages/cli/dist/cfw.js')

  console.log(`Creating project at ${testProjectPath}`)
  console.log()
  fs.cpSync(fixturePath, testProjectPath, { recursive: true })

  console.log('Syncing framework')
  await execInProject(`node ${cfwBinPath} project:tarsync --verbose`, {
    env: { CFW_PATH: CEDAR_FRAMEWORK_PATH },
  })
  console.log()

  console.log(`Building project in ${testProjectPath}`)
  await execInProject(`node ${cedarBinPath} build -v`)
  console.log()
}
