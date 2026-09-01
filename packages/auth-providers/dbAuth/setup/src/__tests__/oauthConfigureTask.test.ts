import type fs from 'node:fs'
import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    getPaths: () => ({
      base: '/cedar-app',
      api: {
        functions: '/cedar-app/api/src/functions',
        lib: '/cedar-app/api/src/lib',
      },
    }),
    isTypeScriptProject: () => true,
    colors: {
      error: (str: string) => str,
      warning: (str: string) => str,
      green: (str: string) => str,
      info: (str: string) => str,
      bold: (str: string) => str,
      underline: (str: string) => str,
    },
    addEnvVarTask: () => {},
  }
})

import { configureOAuthProvidersTask } from '../oauth.setupData'

const authFunctionPath = '/cedar-app/api/src/functions/auth.ts'

// node:fs is mocked above, so read the real template content with the
// actual module -- this is the same pristine content `generateAuthApiFiles`
// would copy to `authFunctionPath` on every setup run, before
// `configureOAuthProvidersTask` prunes it in place.
const realFs = await vi.importActual<typeof fs>('node:fs')
const pristineTemplate = realFs.readFileSync(
  path.resolve(__dirname, '../templates/api/functions/auth.oauth.ts.template'),
  'utf-8',
)

describe('configureOAuthProvidersTask', () => {
  beforeEach(() => {
    vol.reset()
  })

  it('prunes the freshly generated auth function down to the selected providers', () => {
    vol.fromJSON({ [authFunctionPath]: pristineTemplate })

    configureOAuthProvidersTask(['google']).task()

    const content = memfs.readFileSync(authFunctionPath, 'utf-8').toString()
    expect(content).toContain('googleProvider')
    expect(content).not.toContain('githubProvider')
    expect(content).not.toContain('@oauth-provider')
  })

  it('is a no-op when the file has already been pruned', () => {
    vol.fromJSON({ [authFunctionPath]: pristineTemplate })

    configureOAuthProvidersTask(['google']).task()
    const afterFirstRun = memfs
      .readFileSync(authFunctionPath, 'utf-8')
      .toString()

    configureOAuthProvidersTask(['google']).task()
    const afterSecondRun = memfs
      .readFileSync(authFunctionPath, 'utf-8')
      .toString()

    expect(afterSecondRun).toEqual(afterFirstRun)
  })

  it('produces byte-identical output across two separate setup runs, each starting from a fresh template copy', () => {
    // Run 1: `generateAuthApiFiles` writes the pristine template, then the
    // task prunes it in place
    vol.fromJSON({ [authFunctionPath]: pristineTemplate })
    configureOAuthProvidersTask(['google', 'github']).task()
    const run1 = memfs.readFileSync(authFunctionPath, 'utf-8').toString()

    // Run 2: setup re-runs from scratch -- `generateAuthApiFiles` overwrites
    // the file with a fresh, unpruned copy of the same template again
    vol.fromJSON({ [authFunctionPath]: pristineTemplate })
    configureOAuthProvidersTask(['google', 'github']).task()
    const run2 = memfs.readFileSync(authFunctionPath, 'utf-8').toString()

    expect(run2).toEqual(run1)
  })

  it('does nothing if the auth function has not been generated yet', () => {
    expect(() => configureOAuthProvidersTask(['google']).task()).not.toThrow()
    expect(memfs.existsSync(authFunctionPath)).toBe(false)
  })
})
