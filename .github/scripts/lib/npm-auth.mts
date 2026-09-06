/**
 * npm authentication for the publish scripts, with two modes:
 *
 * - `oidc` (the default in CI): npm trusted publishing. The workflow has
 *   `id-token: write`, no npm token exists anywhere, and `npm publish` does
 *   the OIDC token exchange itself (and attaches provenance).
 *
 *   Trusted publishing only covers `npm publish`. It cannot write dist-tags
 *   (https://github.com/npm/cli/issues/8547), so `forDistTag()` refuses to
 *   run in this mode rather than letting `npm dist-tag` fail with a bare 401.
 *   Scripts that move dist-tags (the prerelease publish and the staging-tag
 *   cleanup) have to run with a token.
 *
 * - `token`: a classic `NPM_AUTH_TOKEN`. Used by the jobs that need
 *   dist-tag writes, and available as a fallback for the others so the
 *   scripts still work when run by hand.
 *
 * Tokens never touch the repo's `.npmrc`. Each one is written to its own
 * file in a temp dir that's removed by `dispose()`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REGISTRY_HOST = 'registry.npmjs.org'

/** Trusted publishing needs this or newer, see https://docs.npmjs.com/trusted-publishers */
const MIN_NPM_VERSION_FOR_OIDC = [11, 5, 1] as const

export type NpmAuthMode = 'oidc' | 'token'

export interface NpmAuth {
  mode: NpmAuthMode
  /**
   * Environment to run `npm publish` with. In `oidc` mode this is the plain
   * process environment: npm exchanges the ID token itself, and giving it a
   * token here would make it skip that (and skip provenance).
   */
  forPublish(packageName: string): Promise<NodeJS.ProcessEnv>
  /**
   * Environment to run `npm dist-tag add/rm` with for `packageName`. Throws
   * in `oidc` mode, since trusted publishing can't write dist-tags.
   */
  forDistTag(packageName: string): Promise<NodeJS.ProcessEnv>
  /** Removes every token file this instance wrote */
  dispose(): void
}

export function isOidcAvailable() {
  return Boolean(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  )
}

export function hasNpmCredentials() {
  return Boolean(process.env.NPM_AUTH_TOKEN) || isOidcAvailable()
}

export function getNpmAuthMode(): NpmAuthMode {
  if (process.env.NPM_AUTH_TOKEN) {
    return 'token'
  }

  if (isOidcAvailable()) {
    return 'oidc'
  }

  throw new Error(
    'No npm credentials available. Either run in a GitHub Actions job with ' +
      '`id-token: write` (trusted publishing) or set NPM_AUTH_TOKEN.',
  )
}

function assertNpmSupportsOidc() {
  const version = execFileSync('npm', ['--version'], { encoding: 'utf-8' })
    .trim()
    .split('.')
    .map(Number)

  for (let i = 0; i < MIN_NPM_VERSION_FOR_OIDC.length; i++) {
    if (version[i] > MIN_NPM_VERSION_FOR_OIDC[i]) {
      return
    }

    if (version[i] < MIN_NPM_VERSION_FOR_OIDC[i]) {
      throw new Error(
        `npm ${version.join('.')} is too old for trusted publishing. Need ` +
          `${MIN_NPM_VERSION_FOR_OIDC.join('.')} or newer.`,
      )
    }
  }
}

export function createNpmAuth(): NpmAuth {
  const mode = getNpmAuthMode()

  if (mode === 'oidc') {
    assertNpmSupportsOidc()
  }

  // Into a temp dir rather than the repo root. `.npmrc` is neither tracked
  // nor gitignored, so a token written there is one `git add .` away from
  // being committed by anyone who runs this locally.
  const npmrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-npmrc-'))
  let tokenEnv: NodeJS.ProcessEnv | null = null

  function getTokenEnv(): NodeJS.ProcessEnv {
    if (tokenEnv) {
      return tokenEnv
    }

    const npmrcPath = path.join(npmrcDir, 'token.npmrc')
    fs.writeFileSync(
      npmrcPath,
      `//${REGISTRY_HOST}/:_authToken=${process.env.NPM_AUTH_TOKEN}\n`,
      { mode: 0o600 },
    )

    tokenEnv = { ...process.env, npm_config_userconfig: npmrcPath }

    return tokenEnv
  }

  return {
    mode,

    async forPublish() {
      if (mode === 'token') {
        return getTokenEnv()
      }

      return { ...process.env }
    },

    async forDistTag(packageName) {
      if (mode === 'token') {
        return getTokenEnv()
      }

      throw new Error(
        `Cannot write dist-tags for ${packageName}: npm trusted publishing ` +
          'only covers `npm publish`, not `npm dist-tag` ' +
          '(https://github.com/npm/cli/issues/8547). Run this with ' +
          'NPM_AUTH_TOKEN set.',
      )
    },

    dispose() {
      fs.rmSync(npmrcDir, { recursive: true, force: true })
    },
  }
}
