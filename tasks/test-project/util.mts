import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { Options as ExecaOptions } from 'execa'
import prompts from 'prompts'

import { getOutputPath } from './paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function applyCodemod(codemod: string, target: string) {
  const args = [
    '--fail-on-error',
    '-t',
    `${path.resolve(__dirname, 'codemods', codemod)} ${target}`,
    '--parser',
    'tsx',
    '--verbose=2',
  ]

  args.push()

  const subprocess = exec(
    'yarn jscodeshift',
    args,
    getExecaOptions(path.resolve(import.meta.dirname)),
  )

  return subprocess
}

export const getExecaOptions = (
  cwd: string,
  stdio: 'inherit' | 'pipe' = 'pipe',
): ExecaOptions => ({
  shell: true,
  stdio,
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
    .catch((error) => {
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

export async function addModel(model: string) {
  const prismaPath = `${getOutputPath()}/api/db/schema.prisma`
  const schema = await fs.promises.readFile(prismaPath, 'utf-8')

  return fs.promises.writeFile(prismaPath, `${schema.trim()}\n\n${model}\n`)
}

/**
 * @param cmd The command to run
 */
export function createBuilder(cmd: string, dir = '') {
  const execaOptions = getExecaOptions(path.join(getOutputPath(), dir))

  return async function createItem(positionals?: string | string[]) {
    const args = positionals
      ? Array.isArray(positionals)
        ? positionals
        : [positionals]
      : []
    return execa(cmd, args, execaOptions)
  }
}
