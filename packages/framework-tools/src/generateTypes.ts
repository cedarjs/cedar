import { spawn } from 'node:child_process'
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PackageJson } from 'type-fest'

async function runYarnScript(script: string) {
  const isWindows = process.platform === 'win32'
  const yarnPath = process.env.npm_execpath
  const command = isWindows ? 'cmd.exe' : yarnPath ? process.execPath : 'yarn'
  const args = isWindows
    ? ['/d', '/s', '/c', `corepack yarn ${script}`]
    : yarnPath
      ? [yarnPath, script]
      : [script]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`yarn ${script} exited with code ${code}`))
      }
    })
  })
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
