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
 * print, e.g. `postgres://user:pass@host/db` -> `postgres://user:***@host/db`.
 */
export function redactDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:/?#]+):([^@/?#]+)@/, '://$1:***@')
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
