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

// A trailing dot in a hostname is a valid, DNS-equivalent way of writing an
// absolute (fully-qualified) domain name, e.g. `db.example.com.` resolves to
// the same host as `db.example.com`, so it's stripped before comparison.
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '')
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
    host: normalizeHost(host),
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
      host: parsed.hostname ? normalizeHost(parsed.hostname) : undefined,
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

/**
 * Guards `cedar test api`'s destructive database reset by *identity*, not
 * just provider: refuses to run when the resolved test database is the same
 * database as `DATABASE_URL` — same host, port, and database name, or the
 * same sqlite file.
 *
 * This is deliberately the only check, rather than also requiring the
 * database's *name* to look test-like (e.g. containing "test" or "e2e"). A
 * naming convention doesn't hold for managed Postgres providers with a
 * fixed default database name shared by every project — every Supabase
 * project's database is named `postgres`, for instance — so it can't tell a
 * real project's database apart from a dedicated test one by name alone.
 * Whether the two connection strings resolve to the same database is the
 * one fact that holds across every provider.
 *
 * When there's no `DATABASE_URL` at all to compare against, this fails
 * closed rather than skipping the check: an explicit `TEST_DATABASE_URL`
 * with nothing to confirm it's not the app's real database is refused,
 * since there'd be no way to tell it apart from one that is. Cedar's own
 * generated sqlite fallback (`usedFallback`) is exempt from that fail-closed
 * refusal — it's a path only Cedar controls, so there's no need to force a
 * `DATABASE_URL` to exist just to permit it — but it still runs through the
 * same-database comparison below whenever a `DATABASE_URL` is present, so a
 * project whose real database happens to live at that same generated path
 * is still caught.
 */
export function checkTestDatabaseIdentity(
  testDatabaseUrl: string,
  mainDatabaseUrl: string | undefined,
  usedFallback: boolean,
) {
  if (!mainDatabaseUrl) {
    if (usedFallback) {
      return
    }

    const redactedTestUrl = redactDatabaseUrl(testDatabaseUrl)
    throw new Error(
      `TEST_DATABASE_URL (${redactedTestUrl}) is set, but there's no ` +
        `DATABASE_URL to confirm it isn't the same database your app ` +
        `actually uses. Refusing to run a destructive reset without that ` +
        `confirmation.\n\nSet DATABASE_URL (even to a placeholder) so ` +
        `Cedar can verify TEST_DATABASE_URL points somewhere different.`,
    )
  }

  const sameRawUrl = mainDatabaseUrl === testDatabaseUrl
  const testIdentity = parseDatabaseIdentity(testDatabaseUrl)
  const mainIdentity = parseDatabaseIdentity(mainDatabaseUrl)
  const sameParsedIdentity =
    !!testIdentity &&
    !!mainIdentity &&
    identitiesMatch(testIdentity, mainIdentity)

  if (sameRawUrl || sameParsedIdentity) {
    const redactedTestUrl = redactDatabaseUrl(testDatabaseUrl)
    throw new Error(
      `TEST_DATABASE_URL (${redactedTestUrl}) points at the same database ` +
        `as DATABASE_URL. Refusing to run a destructive reset against ` +
        `your app's main database.\n\nSet TEST_DATABASE_URL to a ` +
        `dedicated test database.`,
    )
  }
}
