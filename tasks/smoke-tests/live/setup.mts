import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { instantPostgres } from 'neon-new/sdk'

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

    databaseUrlDirect = await Promise.race([
      instantPostgres({ referrer: 'cedarjs' }).then((r) => r.databaseUrlDirect),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Neon database provisioning timed out')),
          NEON_TIMEOUT_MS,
        ),
      ),
    ])

    console.log('Neon database provisioned')

    fs.appendFileSync(
      envPath,
      `DIRECT_DATABASE_URL=${databaseUrlDirect}\nDATABASE_URL=${databaseUrlDirect}\n`,
    )
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
