import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExecOptions } from '@actions/exec'

export const CEDAR_FRAMEWORK_PATH = fileURLToPath(
  new URL('../../', import.meta.url),
)

export function setOutput(key: string, value: string) {
  console.log(`setOutput: ${key} = ${value}`)
}

export function getInput(key: string) {
  console.log(`getInput: ${key}`)
  return ''
}

/**
 * This is an approximation of `getExecOutput` from `@actions/exec` that can be
 * used locally (i.e. outside of GitHub Actions) for testing.
 */
function getExecOutput(
  command: string,
  args?: string[],
  options: ExecOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { cwd, env, silent = false, input } = options

    const child = spawn(command, args ?? [], {
      cwd,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString()
      stdout += text

      if (!silent) {
        process.stdout.write(text)
      }
    })

    child.stderr.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString()
      stderr += text

      if (!silent) {
        process.stderr.write(text)
      }
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const error = new Error(
        `Command failed with exit code ${code}: ${command}`,
      ) as Error & {
        code?: number | null
        stdout?: string
        stderr?: string
      }

      error.code = code
      error.stdout = stdout
      error.stderr = stderr

      reject(error)
    })

    if (input !== undefined) {
      child.stdin.write(input)
    }

    child.stdin.end()
  })
}

function execWithEnv(command: string, { env = {}, ...rest }: ExecOptions = {}) {
  const processEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
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

export function createExecWithEnvInCwd(cwd: string) {
  return function (command: string, options: Omit<ExecOptions, 'cwd'> = {}) {
    return execWithEnv(command, { cwd, ...options })
  }
}

export const execInFramework = createExecWithEnvInCwd(CEDAR_FRAMEWORK_PATH)

/**
 * @param commandLine command to execute (can include additional args). Must be
 *   correctly escaped.
 * @param options exec options.  See ExecOptions
 * @returns exit code
 */
type ExecInProject = (
  commandLine: string,
  options?: Omit<ExecOptions, 'cwd'>,
) => Promise<unknown>

export async function setUpRscTestProject(
  testProjectPath: string,
  fixtureName: string,
  core: { setOutput: (key: string, value: string) => void },
  execInProject: ExecInProject,
) {
  core.setOutput('kitchen-sink-project-path', testProjectPath)

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
