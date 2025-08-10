/* eslint-env node */

// To run these tests locally, go to ~/cedarjs-fw/packages/create-cedar-app
// Then run `PROJECT_PATH=./ yarn test:e2e`

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect, it } from 'vitest'
import { cd, fs, $ } from 'zx'

if (!process.env.PROJECT_PATH) {
  throw new Error('PROJECT_PATH environment variable is not set')
}

const projectPath = await fs.realpath(process.env.PROJECT_PATH)
const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__', import.meta.url))

cd(projectPath)

describe('create-cedar-app', () => {
  test('--help', async () => {
    const p = await $`yarn create-cedar-app --help`

    expect(p.exitCode).toEqual(0)
    expect(p.stdout).toMatchInlineSnapshot(`
      "Usage: create-cedar-app <project directory>

      Options:
            --help              Show help                                    [boolean]
            --version           Show version number                          [boolean]
        -y, --yes               Skip prompts and use defaults[boolean] [default: null]
            --overwrite         Create even if target directory isn't empty
                                                            [boolean] [default: false]
            --typescript, --ts  Generate a TypeScript project[boolean] [default: null]
            --git-init, --git   Initialize a git repository  [boolean] [default: null]
        -m, --commit-message    Commit message for the initial commit
                                                              [string] [default: null]
            --telemetry         Enables sending telemetry events for this create
                                command and all Redwood CLI commands
                                https://telemetry.redwoodjs.com
                                                             [boolean] [default: true]
            --yarn-install      Install node modules. Skip via --no-yarn-install.
                                                             [boolean] [default: null]

      Examples:
        create-cedar-app my-cedar-app
      [?25l[?25h"
    `)
    expect(p.stderr).toMatchInlineSnapshot(`"[?25l[?25h"`)
  })

  test('--version', async () => {
    const p = await $`yarn create-cedar-app --version`

    expect(p.exitCode).toEqual(0)
    expect(p.stdout).toMatch(/\d+\.\d+\.\d+/)
    expect(p.stderr).toMatchInlineSnapshot(`"[?25l[?25h"`)
  })

  test('--yes, -y', async () => {
    // Running `yarn install` in Jest test times out and the subsequent step,
    // generating types, is also flakey since `yarn pack` seems to skip
    // `.yarnrc.yml` which is necessary for configuring a proper install.
    const p = await $`yarn create-cedar-app ./cedar-app --no-yarn-install --yes`
    const expected = await fs.readFile(
      path.join(SNAPSHOT_DIR, 'create-cedar-app.out'),
      'utf8',
    )

    expect(p.exitCode).toEqual(0)
    expect(p.stdout).toBe(expected)
    expect(p.stderr).toMatchInlineSnapshot(
      `"[?25l[?25h[?25l[?25h[?25l[?25h[?25l[?25h[?25l[?25h[?25l[?25h[?25l[?25h"`,
    )

    await fs.rm('./cedar-app', { recursive: true, force: true })
  })

  it.fails('fails on unknown options', async () => {
    try {
      await $`yarn create-cedar-app --unknown-options`.timeout(2500)
      // Fail the test if the function didn't throw.
      expect(true).toEqual(false)
    } catch (p) {
      expect(p.exitCode).toEqual(1)
    }
  })
})
