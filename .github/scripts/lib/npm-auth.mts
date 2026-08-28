/**
 * npm authentication for the publish scripts, with two modes:
 *
 * - `oidc` (the default in CI): npm trusted publishing. The workflow has
 *   `id-token: write`, no npm token exists anywhere, and `npm publish` does
 *   the OIDC token exchange itself (and attaches provenance).
 *
 *   The catch is that only `npm publish` knows how to do that exchange.
 *   `npm dist-tag` doesn't, and the staging-tag flow needs it. So for
 *   dist-tag writes this module performs the same exchange npm does
 *   internally: fetch a GitHub ID token for the `npm:registry.npmjs.org`
 *   audience, trade it at the registry for a short-lived token scoped to one
 *   package, and hand that to npm through a throwaway user config.
 *
 * - `token`: a classic `NPM_AUTH_TOKEN`. Kept so the migration can be rolled
 *   out in two steps (configure trusted publishing on npm, then delete the
 *   secret) and so the scripts still work when run by hand.
 *
 * Tokens never touch the repo's `.npmrc`. Each one is written to its own
 * file in a temp dir that's removed by `dispose()`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_HOST = 'registry.npmjs.org'

/** Trusted publishing needs this or newer, see https://docs.npmjs.com/trusted-publishers */
const MIN_NPM_VERSION_FOR_OIDC = [11, 5, 1] as const

const EXCHANGE_TIMEOUT_MS = 30_000

/**
 * How long an exchanged token is reused for the same package. The flip and
 * the staging-tag cleanup hit every package once each within a few minutes,
 * so this saves a round of exchanges without betting on the (short,
 * undocumented) lifetime of the tokens.
 */
const EXCHANGED_TOKEN_TTL_MS = 5 * 60 * 1000

export type NpmAuthMode = 'oidc' | 'token'

export interface NpmAuth {
  mode: NpmAuthMode
  /**
   * Environment to run `npm publish` with. In `oidc` mode this is the plain
   * process environment: npm exchanges the ID token itself, and giving it a
   * token here would make it skip that (and skip provenance).
   */
  forPublish(packageName: string): Promise<NodeJS.ProcessEnv>
  /** Environment to run `npm dist-tag add/rm` with for `packageName` */
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

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  what: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')

    throw new Error(
      `${what} failed with HTTP ${response.status}` +
        (body ? `: ${body.slice(0, 500)}` : ''),
    )
  }

  return (await response.json()) as T
}

/** A GitHub Actions ID token (JWT) for the npm registry audience */
async function getGitHubIdToken(): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN

  if (!requestUrl || !requestToken) {
    throw new Error(
      'ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN are not set. Does the job have ' +
        '`permissions: id-token: write`?',
    )
  }

  const url = new URL(requestUrl)
  url.searchParams.set('audience', `npm:${REGISTRY_HOST}`)

  const { value } = await fetchJson<{ value: string }>(
    url.toString(),
    { headers: { authorization: `Bearer ${requestToken}` } },
    'Fetching the GitHub ID token',
  )

  return value
}

/**
 * Trades a GitHub ID token for a short-lived npm token that can write to
 * `packageName`. This is the same endpoint the npm CLI uses internally.
 * The registry only accepts it if the package has a trusted publisher
 * configured that matches this repo and workflow file.
 */
async function exchangeForNpmToken(packageName: string): Promise<string> {
  const idToken = await getGitHubIdToken()
  const url =
    `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/` +
    encodeURIComponent(packageName)

  const { token } = await fetchJson<{ token: string }>(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
    `OIDC token exchange for ${packageName}`,
  )

  if (!token) {
    throw new Error(`OIDC token exchange for ${packageName} returned no token`)
  }

  return token
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
  let fileCounter = 0

  function writeUserConfig(token: string): NodeJS.ProcessEnv {
    const npmrcPath = path.join(npmrcDir, `${fileCounter++}.npmrc`)
    fs.writeFileSync(npmrcPath, `//${REGISTRY_HOST}/:_authToken=${token}\n`, {
      mode: 0o600,
    })

    return { ...process.env, npm_config_userconfig: npmrcPath }
  }

  let legacyTokenEnv: NodeJS.ProcessEnv | null = null
  const exchangedEnvs = new Map<
    string,
    { env: NodeJS.ProcessEnv; expiresAt: number }
  >()

  function legacyEnv() {
    legacyTokenEnv ??= writeUserConfig(process.env.NPM_AUTH_TOKEN as string)

    return legacyTokenEnv
  }

  return {
    mode,

    async forPublish() {
      if (mode === 'token') {
        return legacyEnv()
      }

      return { ...process.env }
    },

    async forDistTag(packageName) {
      if (mode === 'token') {
        return legacyEnv()
      }

      const cached = exchangedEnvs.get(packageName)

      if (cached && cached.expiresAt > Date.now()) {
        return cached.env
      }

      const env = writeUserConfig(await exchangeForNpmToken(packageName))
      exchangedEnvs.set(packageName, {
        env,
        expiresAt: Date.now() + EXCHANGED_TOKEN_TTL_MS,
      })

      return env
    },

    dispose() {
      fs.rmSync(npmrcDir, { recursive: true, force: true })
    },
  }
}
