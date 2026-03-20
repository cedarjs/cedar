import fs from 'node:fs'
import path from 'node:path'

interface Args {
  setOutput: (key: string, value: string) => void
  getInput: (key: string) => string
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

export async function setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath,
  testProjectPath,
}: Args) {
  const execInProject = createExecWithEnvInCwd(testProjectPath)

  setOutput('kitchen-sink-project-path', testProjectPath)

  const canary = getInput('canary') === 'true'
  console.log({ canary })

  console.log()

  const TEST_PROJECT_FIXTURE_PATH = path.join(
    cedarFrameworkPath,
    '__fixtures__',
    'kitchen-sink-project',
  )

  console.log(`Creating project at ${testProjectPath}`)
  console.log()

  await fs.promises.cp(TEST_PROJECT_FIXTURE_PATH, testProjectPath, {
    recursive: true,
  })

  if (canary) {
    console.log(`Upgrading project to canary`)

    await execInProject('yarn cedar upgrade -t canary', {
      input: Buffer.from('Y'),
    })

    console.log()
  }

  await execInFramework('yarn project:tarsync --verbose', {
    env: { CEDAR_CWD: testProjectPath },
  })

  console.log('Generating dbAuth secret')
  const { stdout } = await execInProject(
    'yarn cedar g secret --raw --no-prisma',
    {
      silent: true,
    },
  )
  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `SESSION_SECRET='${stdout}'`,
  )
  console.log()

  // .env.user is gitignored in the fixture. Creating it here so that
  // `--load-env-files user` can find it and prisma.config.cjs can read
  // CEDAR_SMOKE_TEST_ENV_VAR
  fs.writeFileSync(
    path.join(testProjectPath, '.env.user'),
    'CEDAR_SMOKE_TEST_ENV_VAR=test-value\n',
  )

  console.log('Running prisma migrate reset')
  await execInProject(
    'yarn cedar prisma migrate reset --force --load-env-files user',
  )

  console.log('Running prisma db seed')
  await execInProject('yarn cedar prisma db seed --load-env-files user')
}
