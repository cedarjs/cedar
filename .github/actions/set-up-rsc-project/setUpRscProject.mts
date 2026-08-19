import path from 'node:path'

import type { ExecOptions } from '@actions/exec'

import { CEDAR_FRAMEWORK_PATH } from '../actionsLib.mjs'

/**
 * Exec a command.
 * Output will be streamed to the live console.
 * Returns promise with return code
 *
 * @param commandLine command to execute (can include additional args). Must be correctly escaped.
 * @param args arguments for tool. Escaping is handled by the lib.
 * @param options exec options. See ExecOptions
 */
type Exec = (
  commandLine: string,
  args?: string[],
  options?: ExecOptions,
) => Promise<unknown>

/**
 * Exec a command in the project directory.
 * Output will be streamed to the live console.
 * Returns promise with return code
 *
 * @param commandLine command to execute (can include additional args). Must be correctly escaped.
 * @param options exec options. See ExecOptions
 */
type ExecInProject = (
  commandLine: string,
  options?: Omit<ExecOptions, 'cwd'>,
) => Promise<unknown>

export async function main(
  rscProjectPath: string,
  core: { setOutput: (key: string, value: string) => void },
  exec: Exec,
  execInProject: ExecInProject,
): Promise<void> {
  core.setOutput('rsc-project-path', rscProjectPath)

  console.log('Cedar Framework Path', CEDAR_FRAMEWORK_PATH)
  console.log('rscProjectPath', rscProjectPath)

  await setUpRscProject(rscProjectPath, exec, execInProject)
}

async function setUpRscProject(
  rscProjectPath: string,
  exec: Exec,
  execInProject: ExecInProject,
): Promise<void> {
  const cedarBinPath = path.join(
    CEDAR_FRAMEWORK_PATH,
    'packages/cli/dist/index.js',
  )
  const createCedarAppBinPath = path.join(
    CEDAR_FRAMEWORK_PATH,
    'packages/create-cedar-app/dist/create-cedar-app.js',
  )
  const cfwBinPath = path.join(CEDAR_FRAMEWORK_PATH, 'packages/cli/dist/cfw.js')

  console.log(`Creating project at ${rscProjectPath}`)
  console.log()

  // `-y` implies `--install`, so this also creates the project's yarn.lock.
  // Nothing else may run yarn in the project before this finishes — yarn 4's
  // hardened mode (on for public PRs) rejects any invocation made without a
  // lockfile present.
  await exec('node', [
    createCedarAppBinPath,
    '-y',
    '--no-git',
    '--pm',
    'yarn',
    rscProjectPath,
  ])

  console.log(`Setting up Streaming/SSR in ${rscProjectPath}`)
  const cmdSetupStreamingSSR = `node ${cedarBinPath} experimental setup-streaming-ssr -f`
  await execInProject(cmdSetupStreamingSSR)
  console.log()

  console.log(`Setting up RSC in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} experimental setup-rsc`)
  console.log()

  // Run the cfw bin built from this commit rather than the project's own
  // (`yarn cfw`). The project installs the last *released* `@cedarjs/*`
  // packages, so `yarn cfw` would resolve to a released tarsync, which is both
  // older than the framework it is syncing and blind to any tarsync change the
  // PR makes. The RSA and RSC-kitchen-sink setups already invoke the local bin
  // this way (see `actionsLib.mjs`).
  console.log('Syncing framework')
  await execInProject(`node ${cfwBinPath} project:tarsync --verbose`, {
    env: {
      CFW_PATH: CEDAR_FRAMEWORK_PATH,
    },
  })
  console.log()

  console.log(`Building project in ${rscProjectPath}`)
  await execInProject(`node ${cedarBinPath} build -v`)
  console.log()
}
