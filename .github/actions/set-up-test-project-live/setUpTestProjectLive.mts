import fs from 'node:fs'
import path from 'node:path'

interface Args {
  setOutput: (key: string, value: string) => void
  createExecWithEnvInCwd: (
    cwd: string,
  ) => (
    command: string,
    options?: { silent?: boolean; input?: Buffer },
  ) => Promise<{ stdout: string; stderr: string }>
  execInFramework: (
    command: string,
    options?: { env?: Record<string, string> },
  ) => Promise<{ stdout: string; stderr: string }>
  cedarFrameworkPath: string
  testProjectPath: string
}

export async function setUpTestProjectLive({
  setOutput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath,
  testProjectPath,
}: Args) {
  const execInProject = createExecWithEnvInCwd(testProjectPath)

  setOutput('test-project-path', testProjectPath)

  console.log()

  const TEST_PROJECT_FIXTURE_PATH = path.join(
    cedarFrameworkPath,
    '__fixtures__',
    'test-project-live',
  )

  console.log(`Creating project at ${testProjectPath}`)
  console.log()

  await fs.promises.cp(TEST_PROJECT_FIXTURE_PATH, testProjectPath, {
    recursive: true,
  })

  await execInFramework('yarn project:tarsync --verbose', {
    env: { CEDAR_CWD: testProjectPath },
  })

  console.log('Generating dbAuth secret')
  const { stdout } = await execInProject('yarn cedar g secret --raw', {
    silent: true,
  })
  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `SESSION_SECRET='${stdout}'\n`,
  )
  console.log()

  console.log('Provisioning Neon database...')

  // The Neon CLI has no programmatic API for provisioning a claimable
  // database, so provisioning here shells out to the CLI directly.
  const neonBin = path.join(cedarFrameworkPath, 'node_modules', '.bin', 'neon')
  await execInProject(`"${neonBin}" claim create --file .env --output json`)

  const env = fs.readFileSync(path.join(testProjectPath, '.env'), 'utf-8')
  const databaseUrl = env
    .split('\n')
    .find((line) => line.startsWith('DATABASE_URL='))
    ?.split('=')
    .slice(1)
    .join('=')

  if (!databaseUrl) {
    throw new Error('`neon claim create` did not write DATABASE_URL to .env')
  }

  // `neon claim create` only writes the pooled connection string. Prisma
  // Migrate needs a direct connection (PgBouncer's transaction pooling
  // doesn't reliably support the advisory locks Migrate takes), so derive
  // it from Neon's endpoint naming convention: the direct host is the
  // pooled host with "-pooler" removed.
  const databaseUrlDirect = databaseUrl.replace('-pooler.', '.')
  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `DIRECT_DATABASE_URL=${databaseUrlDirect}\n`,
  )

  console.log('Running prisma migrate reset')
  await execInProject('yarn cedar prisma migrate reset --force')

  console.log('Running prisma db seed')
  await execInProject('yarn cedar prisma db seed')
}
