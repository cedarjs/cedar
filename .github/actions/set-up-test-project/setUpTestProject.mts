import fs from 'node:fs'
import path from 'node:path'

interface Args {
  setOutput: (key: string, value: string) => void
  getInput: (key: string) => string
  createExecWithEnvInCwd: (cwd: string) => (
    command: string,
    options?: {
      silent?: boolean
      input?: Buffer
      ignoreReturnCode?: boolean
    },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  execInFramework: (
    command: string,
    options?: { env?: Record<string, string> },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
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

  setOutput('test-project-path', testProjectPath)

  const canary = getInput('canary') === 'true'
  console.log({ canary })

  console.log()

  const TEST_PROJECT_FIXTURE_PATH = path.join(
    cedarFrameworkPath,
    '__fixtures__',
    'test-project',
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

  const yarnLockPath = path.join(testProjectPath, 'yarn.lock')
  if (fs.existsSync(yarnLockPath)) {
    const lockfileContent = fs.readFileSync(yarnLockPath, 'utf-8')
    const lines = lockfileContent.split('\n')
    console.log(`yarn.lock created (${lines.length} lines)`)
    const rootWorkspaceLine = lines.find((l) => l.startsWith('root-workspace-'))
    if (rootWorkspaceLine) {
      console.log(`Root workspace entry found: ${rootWorkspaceLine}`)
    } else {
      console.error(
        'WARNING: yarn.lock exists but has no root-workspace- entry!',
      )
    }
  } else {
    console.error('WARNING: yarn.lock was not created by tarsync!')
  }

  console.log('Generating dbAuth secret')
  const secretResult = await execInProject('yarn cedar g secret --raw', {
    silent: true,
    ignoreReturnCode: true,
  })
  if (secretResult.exitCode !== 0) {
    console.error(
      `yarn cedar g secret --raw failed with exit code ${secretResult.exitCode}`,
    )
    console.error('stdout:', secretResult.stdout || '(empty)')
    console.error('stderr:', secretResult.stderr || '(empty)')
    throw new Error(
      `yarn cedar g secret --raw failed with exit code ${secretResult.exitCode}`,
    )
  }
  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `SESSION_SECRET='${secretResult.stdout}'`,
  )
  console.log()

  console.log('Running prisma migrate reset')
  await execInProject('yarn cedar prisma migrate reset --force')

  console.log('Running prisma db seed')
  await execInProject('yarn cedar prisma db seed')
}
