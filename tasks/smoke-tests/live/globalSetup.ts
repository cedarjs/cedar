import fs from 'node:fs'
import path from 'node:path'

import { instantPostgres } from 'neon-new/sdk'

const PRISMA_TIMEOUT_MS = 120_000
const NEON_TIMEOUT_MS = 30_000

export default async function globalSetup() {
  const testProjectPath = process.env.CEDAR_TEST_PROJECT_PATH

  if (!testProjectPath) {
    throw new Error(
      'CEDAR_TEST_PROJECT_PATH env var is required. ' +
        'Set it to the path of the test-project-live fixture.',
    )
  }

  console.log('Provisioning ephemeral Neon database...')

  const { databaseUrlDirect } = await Promise.race([
    instantPostgres({ referrer: 'cedarjs' }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Neon database provisioning timed out')),
        NEON_TIMEOUT_MS,
      ),
    ),
  ])

  console.log('Neon database provisioned')

  const envPath = path.join(testProjectPath, '.env')

  fs.writeFileSync(
    envPath,
    `DIRECT_DATABASE_URL=${databaseUrlDirect}\nDATABASE_URL=${databaseUrlDirect}\n`,
  )

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
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)

  await Promise.race([
    execAsync(command, {
      cwd,
      env: {
        ...process.env,
        DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Command timed out: ${command}`)),
        timeoutMs,
      ),
    ),
  ])
}
