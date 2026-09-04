import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const PRISMA_TIMEOUT_MS = 30_000
const NEON_TIMEOUT_MS = 30_000

export default async function setup() {
  const testProjectPath = process.env.CEDAR_TEST_PROJECT_PATH

  if (!testProjectPath) {
    throw new Error(
      'CEDAR_TEST_PROJECT_PATH env var is required. ' +
        'Set it to the path of the test-project-live fixture.',
    )
  }

  const envPath = path.join(testProjectPath, '.env')
  const existingEnv = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8')
    : ''

  const existingUrl = existingEnv
    .split('\n')
    .find((line) => line.startsWith('DIRECT_DATABASE_URL='))
    ?.split('=')
    .slice(1)
    .join('=')

  let databaseUrlDirect: string

  if (existingUrl) {
    console.log('Using existing DIRECT_DATABASE_URL from .env')
    databaseUrlDirect = existingUrl
  } else {
    console.log('Provisioning ephemeral Neon database...')

    // The Neon CLI has no programmatic API for provisioning a claimable
    // database, so shell out to it instead of importing an SDK.
    const neonBin = path.join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'node_modules',
      '.bin',
      'neon',
    )

    await execWithTimeout(
      `${neonBin} claim create --file .env --output json`,
      testProjectPath,
      NEON_TIMEOUT_MS,
    )

    console.log('Neon database provisioned')

    const updatedEnv = fs.readFileSync(envPath, 'utf-8')
    const provisionedUrl = updatedEnv
      .split('\n')
      .find((line) => line.startsWith('DATABASE_URL='))
      ?.split('=')
      .slice(1)
      .join('=')

    if (!provisionedUrl) {
      throw new Error('`neon claim create` did not write DATABASE_URL to .env')
    }

    // `neon claim create` only writes the pooled connection string, but this
    // smoke test exercises live queries, which rely on LISTEN/NOTIFY over a
    // persistent session — something PgBouncer's transaction pooling doesn't
    // support. So derive the direct connection from Neon's endpoint naming
    // convention (the direct host is the pooled host with "-pooler" removed)
    // and use it for both the app and Prisma Migrate, same as before.
    databaseUrlDirect = provisionedUrl.replace('-pooler.', '.')

    fs.writeFileSync(
      envPath,
      updatedEnv.replace(
        `DATABASE_URL=${provisionedUrl}`,
        `DATABASE_URL=${databaseUrlDirect}`,
      ),
    )
    fs.appendFileSync(envPath, `DIRECT_DATABASE_URL=${databaseUrlDirect}\n`)
  }

  console.log('Running Prisma migrations...')

  await execWithTimeout(
    'yarn cedar prisma migrate reset --force',
    testProjectPath,
    PRISMA_TIMEOUT_MS,
  )

  console.log('Seeding database...')

  await execWithTimeout(
    'yarn cedar prisma db seed',
    testProjectPath,
    PRISMA_TIMEOUT_MS,
  )

  console.log('Database ready')

  return { DIRECT_DATABASE_URL: databaseUrlDirect }
}

async function execWithTimeout(
  command: string,
  cwd: string,
  timeoutMs: number,
) {
  const execAsync = util.promisify(exec)

  let timer: NodeJS.Timeout | undefined

  await Promise.race([
    execAsync(command, {
      cwd,
      env: { ...process.env },
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Command timed out: ${command}`)),
        timeoutMs,
      )
    }),
  ])

  if (timer) {
    clearTimeout(timer)
  }
}

const entryFile = process.argv?.[1]

if (entryFile === import.meta.filename) {
  await setup()
}
