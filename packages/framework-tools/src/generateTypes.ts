import { spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PackageJson } from 'type-fest'

async function runYarnScript(script: string) {
  const isWindows = process.platform === 'win32'
  const yarnPath = process.env.npm_execpath
  const { args, command } = getYarnCommand({ isWindows, script, yarnPath })

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else if (code !== null) {
        reject(new Error(`yarn ${script} exited with code ${code}`))
      } else {
        reject(new Error(`yarn ${script} was killed by signal ${signal}`))
      }
    })
  })
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
        return {
          command: 'cmd.exe',
          args: ['/d', '/c', 'call', yarnCmdPath, script],
        }
      }

      const extension = path.extname(yarnPath).toLowerCase()

      if (['.cjs', '.js', '.mjs'].includes(extension)) {
        return { command: process.execPath, args: [yarnPath, script] }
      }

      if (['.bat', '.cmd'].includes(extension)) {
        return {
          command: 'cmd.exe',
          args: ['/d', '/c', 'call', yarnPath, script],
        }
      }

      return { command: yarnPath, args: [script] }
    }

    return {
      command: 'cmd.exe',
      args: ['/d', '/c', 'corepack', 'yarn', script],
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
    process.exitCode = 1
    throw new Error(String(e))
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
    process.exitCode = 1
    throw new Error(String(e))
  }
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
