import path from 'node:path'

import { getPrismaDatasourceProvider } from '@cedarjs/project-config'

// Maps a Prisma datasource provider to the URL scheme(s) it expects.
const PROVIDER_URL_SCHEMES: Record<string, string[]> = {
  sqlite: ['file:'],
  postgresql: ['postgres:', 'postgresql:'],
  postgres: ['postgres:', 'postgresql:'],
  cockroachdb: ['postgres:', 'postgresql:'],
  mysql: ['mysql:'],
  sqlserver: ['sqlserver:'],
  mongodb: ['mongodb:', 'mongodb+srv:'],
}

function getUrlScheme(url: string): string | undefined {
  const match = url.match(/^([a-z][a-z0-9+.-]*:)/i)
  return match?.[1]?.toLowerCase()
}

/**
 * Redacts credentials from a database connection string so it's safe to
 * print. Handles both URI-style authority credentials, e.g.
 * `postgres://user:pass@host/db` -> `postgres://user:***@host/db`, and
 * semicolon-delimited key/value credentials used by SQL Server connection
 * strings, e.g. `Server=host;Password=secret;` -> `Server=host;Password=***;`.
 */
export function redactDatabaseUrl(url: string): string {
  return url
    .replace(/:\/\/([^:/?#]+):([^@/?#]+)@/, '://$1:***@')
    .replace(/((?:^|;)\s*password\s*=)[^;]*/gi, '$1***')
}

/**
 * Checks that the `DATABASE_URL` about to be used for tests matches the
 * datasource provider configured in `schema.prisma`, and throws an
 * actionable error if they don't match.
 *
 * Without this check, running `prisma db push`/`migrate reset` against a
 * mismatched provider/URL combination (e.g. a leftover sqlite fallback URL
 * with a `postgresql` schema) can hang indefinitely with no output, instead
 * of failing fast. See https://github.com/cedarjs/cedar/issues/2284.
 *
 * If the provider can't be determined (e.g. `schema.prisma` doesn't exist
 * yet), this is a no-op — Prisma itself will surface the problem.
 */
export async function checkTestDatabaseUrlMatchesProvider(
  databaseUrl: string,
  usedFallback: boolean,
) {
  let provider: string

  try {
    provider = await getPrismaDatasourceProvider()
  } catch {
    return
  }

  const expectedSchemes = PROVIDER_URL_SCHEMES[provider]
  if (!expectedSchemes) {
    // Unknown/unmapped provider — nothing to validate against.
    return
  }

  const actualScheme = getUrlScheme(databaseUrl)
  if (actualScheme && expectedSchemes.includes(actualScheme)) {
    return
  }

  const redactedUrl = redactDatabaseUrl(databaseUrl)

  const reason = usedFallback
    ? `TEST_DATABASE_URL is not set, so the default sqlite test database ` +
      `was used (${redactedUrl}), but your schema.prisma is configured ` +
      `for "${provider}". Set TEST_DATABASE_URL to a "${provider}" ` +
      `connection string to run tests.`
    : `TEST_DATABASE_URL (${redactedUrl}) does not match the "${provider}" ` +
      `provider configured in schema.prisma. Update TEST_DATABASE_URL to a ` +
      `"${provider}" connection string.`

  throw new Error(
    `Test database URL does not match your Prisma schema's provider.\n\n${reason}`,
  )
}

// Default port per provider scheme, used so e.g. an explicit `:5432` and an
// omitted port compare as identical.
const DEFAULT_PORTS: Record<string, string> = {
  'postgresql:': '5432',
  'mysql:': '3306',
  'sqlserver:': '1433',
  'mongodb:': '27017',
}

function normalizeScheme(scheme: string): string {
  return scheme === 'postgres:' ? 'postgresql:' : scheme
}

interface DatabaseIdentity {
  scheme: string
  host?: string
  port?: string
  database?: string
}

function parseSqlServerIdentity(url: string): DatabaseIdentity | undefined {
  const [authority, ...params] = url.split(';')
  const match = authority.match(
    /^([a-z][a-z0-9+.-]*:)\/\/([^:/?#]+)(?::(\d+))?/i,
  )
  if (!match) {
    return undefined
  }

  const [, scheme, host, port] = match
  const databaseParam = params.find((param) => /^\s*database\s*=/i.test(param))
  const database = databaseParam?.slice(databaseParam.indexOf('=') + 1).trim()

  return {
    scheme: scheme.toLowerCase(),
    host: host.toLowerCase(),
    port,
    database,
  }
}

function parseUriIdentity(url: string): DatabaseIdentity | undefined {
  try {
    const parsed = new URL(url)
    const database =
      decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ||
      undefined

    return {
      scheme: parsed.protocol.toLowerCase(),
      host: parsed.hostname.toLowerCase() || undefined,
      port: parsed.port || undefined,
      database,
    }
  } catch {
    return undefined
  }
}

/**
 * Parses a database connection string into the pieces that identify *which*
 * database it points at (as opposed to `getUrlScheme`, which only looks at
 * the provider). Sqlite URLs resolve to an absolute file path; every other
 * supported provider resolves to scheme/host/port/database.
 */
function parseDatabaseIdentity(url: string): DatabaseIdentity | undefined {
  const scheme = getUrlScheme(url)
  if (!scheme) {
    return undefined
  }

  if (scheme === 'file:') {
    return { scheme, database: path.resolve(url.slice('file:'.length)) }
  }

  if (scheme === 'sqlserver:') {
    return parseSqlServerIdentity(url)
  }

  return parseUriIdentity(url)
}

function identitiesMatch(a: DatabaseIdentity, b: DatabaseIdentity): boolean {
  const schemeA = normalizeScheme(a.scheme)
  const schemeB = normalizeScheme(b.scheme)
  if (schemeA !== schemeB) {
    return false
  }

  if (schemeA === 'file:') {
    return !!a.database && a.database === b.database
  }

  // Without a database name on both sides we can't confirm they're the same
  // database, so don't treat that as a match.
  if (!a.database || !b.database || a.database !== b.database) {
    return false
  }

  const portA = a.port || DEFAULT_PORTS[schemeA] || ''
  const portB = b.port || DEFAULT_PORTS[schemeA] || ''

  return (a.host ?? '') === (b.host ?? '') && portA === portB
}

// Database names Cedar recognizes as test databases without any explicit
// override, per https://github.com/cedarjs/cedar/issues/2622.
const TEST_DATABASE_NAME_PATTERN = /test|e2e/i

export interface CheckTestDatabaseIdentityOptions {
  /** True when `TEST_DATABASE_URL` wasn't set and Cedar's own generated sqlite fallback was used instead. */
  usedFallback: boolean
  /** The app's real `DATABASE_URL`, i.e. the one tests must never reset. */
  mainDatabaseUrl?: string
  /** Database names to accept even though they don't match the `test`/`e2e` naming convention, from `cedar.toml`'s `test.acceptedTestDatabaseNames`. */
  acceptedTestDatabaseNames?: string[]
}

/**
 * Guards `cedar test api`'s destructive database reset by *identity*, not
 * just provider: refuses to run when the resolved test database is the same
 * database as `DATABASE_URL`, or when it doesn't look like a dedicated test
 * database and hasn't been explicitly accepted as one.
 *
 * Cedar's own generated sqlite fallback (used when `TEST_DATABASE_URL` isn't
 * set) is always accepted — it's a path Cedar controls, never the app's real
 * database.
 */
export function checkTestDatabaseIdentity(
  testDatabaseUrl: string,
  {
    usedFallback,
    mainDatabaseUrl,
    acceptedTestDatabaseNames = [],
  }: CheckTestDatabaseIdentityOptions,
) {
  if (usedFallback) {
    return
  }

  const redactedTestUrl = redactDatabaseUrl(testDatabaseUrl)
  const testIdentity = parseDatabaseIdentity(testDatabaseUrl)

  if (mainDatabaseUrl) {
    const sameRawUrl = mainDatabaseUrl === testDatabaseUrl
    const mainIdentity = parseDatabaseIdentity(mainDatabaseUrl)
    const sameParsedIdentity =
      !!testIdentity &&
      !!mainIdentity &&
      identitiesMatch(testIdentity, mainIdentity)

    if (sameRawUrl || sameParsedIdentity) {
      throw new Error(
        `TEST_DATABASE_URL (${redactedTestUrl}) points at the same database ` +
          `as DATABASE_URL. Refusing to run a destructive reset against ` +
          `your app's main database.\n\nSet TEST_DATABASE_URL to a ` +
          `dedicated test database.`,
      )
    }
  }

  const databaseName = testIdentity?.database

  if (databaseName && TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    return
  }

  const acceptedByEnvVar =
    !!databaseName &&
    !!process.env.TEST_DATABASE_ACCEPT_TARGET &&
    process.env.TEST_DATABASE_ACCEPT_TARGET === databaseName

  const acceptedByConfig =
    !!databaseName && acceptedTestDatabaseNames.includes(databaseName)

  if (acceptedByEnvVar || acceptedByConfig) {
    return
  }

  throw new Error(
    `Test database (${redactedTestUrl}) doesn't look like a dedicated test ` +
      `database — its name doesn't contain "test" or "e2e". Refusing to run ` +
      `a destructive reset against it.\n\nIf this is intentional, either ` +
      `rename the database, add its name to cedar.toml's ` +
      `\`test.acceptedTestDatabaseNames\`, or set ` +
      `TEST_DATABASE_ACCEPT_TARGET=${databaseName ?? '<database name>'} for ` +
      `a one-off/CI override.`,
  )
}
