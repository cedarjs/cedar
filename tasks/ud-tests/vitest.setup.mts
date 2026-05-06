import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, beforeAll } from 'vitest'
import { fs, path, $ } from 'zx'
import type { ProcessPromise } from 'zx'

import { getConfig } from '@cedarjs/project-config'

$.verbose = !!process.env.VERBOSE

const fixtureUrl = new URL('./fixtures/cedar-app', import.meta.url)
export const FIXTURE_PATH = fileURLToPath(fixtureUrl)

/** Resolve the cedar CLI binary from the monorepo */
function resolveCedarBin() {
  const cliPackagePath = path.resolve(import.meta.dirname, '../../packages/cli')
  const packageJsonPath = path.join(cliPackagePath, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const binPath = path.resolve(cliPackagePath, packageJson.bin.cedar)
  return binPath
}

export const cedar = resolveCedarBin()

export const testContext = {
  processes: [] as ProcessPromise[],
  projectConfig: {} as ReturnType<typeof getConfig>,
}

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = FIXTURE_PATH
  testContext.projectConfig = getConfig()
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

afterEach(async () => {
  for (const p of testContext.processes) {
    p.kill()
    try {
      await p
    } catch {
      // ignore
    }
  }
  testContext.processes = []
})

export function sleep(time = 1_000) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

export async function pollForReady(
  url: string,
  opts: { timeout?: number; interval?: number } = {},
) {
  const { timeout = 30_000, interval = 250 } = opts
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url)
      if (res.status < 500) {
        return res
      }
    } catch {
      // not ready yet
    }
    await sleep(interval)
  }

  throw new Error(`Server at ${url} did not become ready within ${timeout}ms`)
}

export async function buildFixture(args: string[] = []) {
  await $`yarn node ${cedar} build api web --ud ${args}`
}
