import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { PackageJson } from 'type-fest'

async function runYarnScript(script: string) {
  const isWindows = process.platform === 'win32'
  const yarnPath = process.env.npm_execpath
  const { args, command } = getYarnCommand({ isWindows, script, yarnPath })

  await execa(command, args, { stdio: 'inherit' })
}

function getYarnCommand({
  isWindows,
  script,
  yarnPath,
}: {
  isWindows: boolean
  script: string
  yarnPath?: string
}) {
  if (isWindows) {
    if (yarnPath) {
      const yarnCmdPath = `${yarnPath}.cmd`

      if (existsSync(yarnCmdPath)) {
        return { command: yarnCmdPath, args: [script] }
      }

      const extension = path.extname(yarnPath).toLowerCase()

      if (['.cjs', '.js', '.mjs'].includes(extension)) {
        return { command: process.execPath, args: [yarnPath, script] }
      }

      return { command: yarnPath, args: [script] }
    }

    return {
      command: 'corepack',
      args: ['yarn', script],
    }
  }

  if (!yarnPath) {
    return { command: 'yarn', args: [script] }
  }

  const extension = path.extname(yarnPath).toLowerCase()

  if (['.cjs', '.js', '.mjs'].includes(extension)) {
    return { command: process.execPath, args: [yarnPath, script] }
  }

  return { command: yarnPath, args: [script] }
}

/**
 * This function will run `yarn build:types-cjs` to generate the CJS type
 * definitions.
 *
 * It will also temporarily change the package.json file to have
 *`"type": "commonjs"`. This is the most reliable way to generate CJS type
 * definitions[1]. It will revert the package.json file back to its original
 * state after the types have been generated - even if an error occurs.
 *
 * [1]: https://github.com/arethetypeswrong/arethetypeswrong.github.io/issues/21#issuecomment-1494618930
 */
export async function generateTypesCjs() {
  copyFileSync('package.json', 'package.json.bak')

  const packageJson: PackageJson = JSON.parse(
    readFileSync('./package.json', 'utf-8'),
  )
  packageJson.type = 'commonjs'
  writeFileSync('./package.json', JSON.stringify(packageJson, null, 2))

  try {
    await runYarnScript('build:types-cjs')
  } catch (e) {
    console.error('---- Error building CJS types ----')
    process.exitCode = getExitCode(e) ?? 1
    throw e
  } finally {
    renameSync('package.json.bak', 'package.json')
  }
}

/**
 * This function will run `yarn build:types` to generate the ESM type
 * definitions.
 */
export async function generateTypesEsm() {
  try {
    await runYarnScript('build:types')
  } catch (e) {
    console.error('---- Error building ESM types ----')
    process.exitCode = getExitCode(e) ?? 1
    throw e
  }
}

function getExitCode(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'exitCode' in e) {
    const exitCode = e.exitCode

    if (typeof exitCode === 'number') {
      return exitCode
    }
  }

  return undefined
}

/**
 * This function will insert a package.json file with "type": "commonjs" in the
 * CJS build directory. This is necessary for the CJS build to be recognized as
 * CommonJS modules when the root package.json file has `"type": "module"`.
 */
export async function insertCommonJsPackageJson({
  buildFileUrl,
  cjsDir = 'dist/cjs',
}: {
  buildFileUrl: string
  cjsDir?: string
}) {
  const packageDir = path.dirname(fileURLToPath(buildFileUrl))
  const packageJsonPath = path.join(packageDir, cjsDir, 'package.json')
  writeFileSync(packageJsonPath, JSON.stringify({ type: 'commonjs' }))
}
