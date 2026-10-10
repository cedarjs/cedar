import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

export const GRAPHQL_URL = 'http://localhost:8910/.api/functions/graphql'

function getProjectPath() {
  const projectPath = process.env.CEDAR_TEST_PROJECT_PATH

  if (!projectPath) {
    throw new Error(
      'Set CEDAR_TEST_PROJECT_PATH to the path of the Cedar app to test',
    )
  }

  return projectPath
}

/**
 * Runs a shell command in the test project and waits for it to finish.
 * `execSync` blocks the event loop, so Playwright's own test timeout can't
 * interrupt a stalled command; the command gets a timeout of its own instead
 */
export function exec(command: string) {
  execSync(command, {
    cwd: getProjectPath(),
    stdio: 'inherit',
    timeout: 2 * 60_000,
  })
}

/**
 * Runs `yarn cedar <args>` in the test project
 */
export function cedar(args: string) {
  exec(`yarn cedar ${args}`)
}

/**
 * Writes `content` to `relativePath` inside the test project
 */
export function writeProjectFile(relativePath: string, content: string) {
  fs.writeFileSync(path.join(getProjectPath(), relativePath), content)
}

/**
 * Removes the file or directory at `relativePath` inside the test project, if
 * it exists
 */
export function removeProjectPath(relativePath: string) {
  fs.rmSync(path.join(getProjectPath(), relativePath), {
    recursive: true,
    force: true,
  })
}

interface GraphQLBody {
  data?: unknown
  errors?: { message?: string }[]
}

/**
 * Polls the GraphQL endpoint (through the web dev server's proxy, the way the
 * browser reaches it) until `query` returns a 200 response that `isReady`
 * accepts.
 *
 * The API side restarts a little while after its files change, and it keeps
 * serving the old code until then. So when a step changes the API, pass a
 * query that only the new code answers correctly.
 */
export async function waitForGraphQL(
  request: APIRequestContext,
  query: string,
  isReady: (body: GraphQLBody) => boolean = (body) => !body.errors,
) {
  await expect
    .poll(
      async () => {
        try {
          const res = await request.post(GRAPHQL_URL, {
            data: { query },
            failOnStatusCode: false,
          })

          // 502/504 (or similar) while the API server restarts
          if (res.status() !== 200) {
            return `HTTP ${res.status()}`
          }

          const body: GraphQLBody = await res.json()

          return isReady(body) ? 'ready' : JSON.stringify(body)
        } catch (e) {
          return e instanceof Error ? e.message : String(e)
        }
      },
      {
        message: `Waiting for the API side to answer ${query}`,
        timeout: 2 * 60_000,
        intervals: [1_000, 2_000],
      },
    )
    .toBe('ready')
}

/**
 * Waits until the API side is up and serving GraphQL
 */
export async function waitForApiSide(request: APIRequestContext) {
  await waitForGraphQL(request, 'query Q { cedar { version } }')
}

/**
 * Navigates to `url` and runs `assertion`, reloading until it passes.
 *
 * Generators and file writes in the steps rewrite modules (`Routes.jsx` in
 * particular) that Vite is watching. A page load that lands while Vite is
 * still processing those changes can fail to import a half-updated module,
 * which leaves the page broken until the next reload. Navigating again until
 * the page shows the expected content makes the steps independent of that
 * timing.
 */
export async function gotoWhenReady(
  page: Page,
  url: string,
  assertion: () => Promise<void>,
) {
  await expect(async () => {
    await page.goto(url)
    await assertion()
  }).toPass({ timeout: 2 * 60_000, intervals: [1_000, 2_000, 5_000] })
}

/**
 * Waits for `assertion` to pass on the page that is already open, which is
 * what happens when Vite's HMR applies a change.
 *
 * If HMR doesn't apply the change (for example because the module failed to
 * load mid-update), this falls back to reloading the page until the
 * assertion passes. It logs a warning and records a `hmr-fallback` annotation
 * on the test when it does.
 */
export async function expectAfterUpdate(
  page: Page,
  assertion: () => Promise<void>,
) {
  try {
    await assertion()
  } catch {
    const description = `HMR did not apply the change on ${page.url()}; reloading`
    console.warn(description)
    test.info().annotations.push({ type: 'hmr-fallback', description })

    await expect(async () => {
      await page.reload()
      await assertion()
    }).toPass({ timeout: 2 * 60_000, intervals: [1_000, 2_000, 5_000] })
  }
}
