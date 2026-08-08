import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { PackageJson } from 'type-fest'

/**
 * `nx run-many -t build` runs every package's build script in parallel, and
 * several of them (this file included) spawn their own `yarn` child process,
 * which parses every workspace's package.json on startup. On Windows,
 * renaming over a file that another process momentarily has open for reading
 * throws EPERM (unlike POSIX, where that's always safe). That makes this
 * rename transient and worth a few retries rather than a hard failure.
 *
 * See: https://github.com/cedarjs/cedar/issues/2146 and specifically
 * https://github.com/cedarjs/cedar/actions/runs/31239552284
 */
function renameSyncWithRetry(
  oldPath: string,
  newPath: string,
  retries = 5,
  delayMs = 50,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(oldPath, newPath)
      return
    } catch (e) {
      const isRetryableFsError =
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e.code === 'EPERM' || e.code === 'EBUSY')

      if (
        !isRetryableFsError ||
        attempt >= retries ||
        process.platform !== 'win32'
      ) {
        throw e
      }

      // Retries are blocking on purpose: this only ever runs on Windows CI,
      // where the delay is a few tens of ms, and the callers are synchronous
      // build scripts with nothing else to do in the meantime.
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        delayMs * attempt,
      )
    }
  }
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
  // Write to a temp file and rename it into place. Rename is atomic, whereas
  // writing directly to package.json would truncate it first, letting any
  // concurrently starting `yarn` process (which parses every workspace
  // manifest during setup) read a partially written file and crash with a
  // JSON syntax error.
  writeFileSync('./package.json.tmp', JSON.stringify(packageJson, null, 2))
  renameSyncWithRetry('./package.json.tmp', './package.json')

  try {
    await execa('yarn', ['build:types-cjs'], { stdio: 'inherit' })
  } catch (e) {
    console.error('---- Error building CJS types ----')
    process.exitCode = getExitCode(e) ?? 1
    throw e
  } finally {
    renameSyncWithRetry('package.json.bak', 'package.json')
  }
}

/**
 * This function will run `yarn build:types` to generate the ESM type
 * definitions.
 */
export async function generateTypesEsm() {
  try {
    await execa('yarn', ['build:types'], { stdio: 'inherit' })
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
