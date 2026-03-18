import fs from 'node:fs'

export type UpdateEnvDefaultsResult = 'skipped' | 'unmodified' | 'updated'

const OLD_SQLITE_URL = 'file:./dev.db'
const NEW_SQLITE_URL = 'file:./db/dev.db'

/**
 * Transforms `.env.defaults` content, updating the SQLite DATABASE_URL path
 * from `file:./dev.db` to `file:./db/dev.db`.
 */
export function transformEnvDefaults(source: string): string {
  // Only replace the exact old default value — don't touch postgres URLs or
  // already-updated paths.
  return source.replace(
    /^(DATABASE_URL=)file:\.\/dev\.db([ \t]*)$/m,
    `$1${NEW_SQLITE_URL}$2`,
  )
}

export async function updateEnvDefaults(
  envDefaultsPath: string,
): Promise<UpdateEnvDefaultsResult> {
  if (!fs.existsSync(envDefaultsPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(envDefaultsPath, 'utf-8')

  if (!source.includes(`DATABASE_URL=${OLD_SQLITE_URL}`)) {
    return 'unmodified'
  }

  const transformed = transformEnvDefaults(source)

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(envDefaultsPath, transformed, 'utf-8')
  return 'updated'
}

/**
 * Check `.env` (gitignored, may contain secrets) for the old SQLite URL and
 * return a warning string if found, without modifying the file.
 */
export function checkDotEnv(envPath: string): string | null {
  if (!fs.existsSync(envPath)) {
    return null
  }

  const source = fs.readFileSync(envPath, 'utf-8')

  if (source.includes(`DATABASE_URL=${OLD_SQLITE_URL}`)) {
    return (
      `Your .env file still contains DATABASE_URL=${OLD_SQLITE_URL}. ` +
      `You should manually update it to DATABASE_URL=${NEW_SQLITE_URL}.`
    )
  }

  return null
}
