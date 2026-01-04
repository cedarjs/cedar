import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { Options as ExecaOptions } from 'execa'
import prompts from 'prompts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let OUTPUT_PATH: string
let VERBOSE = false

export function setOutputPath(path: string) {
  OUTPUT_PATH = path
}

export function getOutputPath() {
  return OUTPUT_PATH
}

export function setVerbose(verbose: boolean) {
  VERBOSE = verbose
}

export function getVerbose() {
  return VERBOSE
}

export function fullPath(
  name: string,
  { addExtension } = { addExtension: true },
) {
  if (addExtension) {
    if (name.startsWith('api')) {
      name += '.ts'
    } else if (name.startsWith('web')) {
      name += '.tsx'
    }
  }

  return path.join(OUTPUT_PATH, name)
}

export async function applyCodemod(codemod: string, target: string) {
  const args = [
    '--fail-on-error',
    '-t',
    `${path.resolve(__dirname, 'codemods', codemod)} ${target}`,
    '--parser',
    'tsx',
    '--verbose=2',
  ]

  await exec('yarn jscodeshift', args, getExecaOptions(path.resolve(__dirname)))
}

export const getExecaOptions = (cwd: string): ExecaOptions => ({
  shell: true,
  stdio: VERBOSE ? 'inherit' : 'pipe',
  cleanup: true,
  cwd,
  env: {
    RW_PATH: path.join(__dirname, '../../'),
    CFW_PATH: path.join(__dirname, '../../'),
    RWFW_PATH: path.join(__dirname, '../../'),
  },
})

export const updatePkgJsonScripts = ({
  projectPath,
  scripts,
}: {
  projectPath: string
  scripts: Record<string, string>
}) => {
  const projectPackageJsonPath = path.join(projectPath, 'package.json')
  const projectPackageJson = JSON.parse(
    fs.readFileSync(projectPackageJsonPath, 'utf-8'),
  )
  projectPackageJson.scripts = {
    ...projectPackageJson.scripts,
    ...scripts,
  }
  fs.writeFileSync(
    projectPackageJsonPath,
    JSON.stringify(projectPackageJson, undefined, 2),
  )
}

// Confirmation prompt when using --no-copyFromFixture --no-link'
export async function confirmNoFixtureNoLink(
  copyFromFixtureOption: boolean,
  linkOption: boolean,
) {
  if (!copyFromFixtureOption && !linkOption) {
    const { checkNoLink } = await prompts(
      {
        type: 'confirm',
        name: 'checkNoLink',
        message:
          'WARNING: You are building a raw project without the `--link` option.' +
          '\nThe new test-project will NOT build with templates from this branch.' +
          '\nInstead it will build using latest release generator template code.' +
          '\nIf not intended, exit and add the `--link` option.' +
          '\nOtherwise, enter "(y)es" to continue:',
      },
      {
        onCancel: () => {
          process.exit(1)
        },
      },
    )
    return checkNoLink
  }
}

export class ExecaError extends Error {
  stdout: string
  stderr: string
  exitCode: number

  constructor({
    stdout,
    stderr,
    exitCode,
  }: {
    stdout: string
    stderr: string
    exitCode: number
  }) {
    super(`execa failed with exit code ${exitCode}`)
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

export async function exec(
  file: string,
  args?: string[],
  options?: ExecaOptions,
) {
  return execa(file, args ?? [], options)
    .then(({ stdout, stderr, exitCode }) => {
      if (exitCode !== 0) {
        throw new ExecaError({ stdout, stderr, exitCode })
      }

      return { stdout, stderr, exitCode }
    })
    .catch((error: any) => {
      if (error instanceof ExecaError) {
        // Rethrow ExecaError
        throw error
      } else {
        const { stdout = '', stderr = '', exitCode = 1 } = error
        throw new ExecaError({ stdout, stderr, exitCode })
      }
    })
}

// TODO: Remove this as soon as cfw is part of a stable Cedar release, and then
// instead just use `cfw` directly everywhere
export function getCfwBin(projectPath: string) {
  return fs.existsSync(path.join(projectPath, 'node_modules/.bin/cfw'))
    ? 'cfw'
    : 'rwfw'
}