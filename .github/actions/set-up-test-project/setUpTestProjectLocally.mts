import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { setUpTestProject } from './setUpTestProject.mjs'

type ExecOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  silent?: boolean
  input?: string | Buffer
}

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

const cedarFrameworkPath = fileURLToPath(new URL('../../../', import.meta.url))

function setOutput(key: string, value: string) {
  console.log(`setOutput: ${key} = ${value}`)
}

function getInput(key: string) {
  console.log(`getInput: ${key}`)
  return ''
}

function execWithEnv(command: string, { env = {}, ...rest }: ExecOptions = {}) {
  return getExecOutput(command, undefined, {
    env: {
      ...process.env,
      ...env,
    },
    ...rest,
  })
}

function createExecWithEnvInCwd(cwd: string) {
  return function (command: string, options: Omit<ExecOptions, 'cwd'> = {}) {
    return execWithEnv(command, { cwd, ...options })
  }
}

const execInFramework = createExecWithEnvInCwd(cedarFrameworkPath)

const testProjectPath = path.join(process.cwd(), 'ci-test-project')

setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath,
  testProjectPath,
})
