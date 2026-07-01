import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll } from 'vitest'
import { fs, path } from 'zx'

/** Utility function to find bin path from package.json */
function findBinPath(packagePath: string, binName: string) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'),
  )

  if (packageJson.bin?.[binName]) {
    return path.resolve(path.dirname(packagePath), packageJson.bin[binName])
  }

  throw new Error(`Bin '${binName}' not found in ${packagePath} package.json`)
}

function getBinPaths() {
  const cliPackagePath = path.resolve(import.meta.dirname, '../../packages/cli')

  return {
    cedar: findBinPath(cliPackagePath, 'cedar'),
  }
}

export const { cedar } = getBinPaths()

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  const fixtureUrl = new URL('./fixtures/debug-app', import.meta.url)
  const FIXTURE_PATH = fileURLToPath(fixtureUrl)
  process.env.CEDAR_CWD = FIXTURE_PATH
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})
