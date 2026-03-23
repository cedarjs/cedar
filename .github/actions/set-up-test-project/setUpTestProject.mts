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

  setOutput('test-project-path', testProjectPath)

  const canary = getInput('canary') === 'true'
  const packageManager = getInput('packageManager') || 'yarn'
  console.log({ canary, packageManager })

  const cedarCmd =
    packageManager === 'npm' ? 'npx cedar' : `${packageManager} cedar`

  console.log()

  const TEST_PROJECT_FIXTURE_PATH = path.join(
    cedarFrameworkPath,
    '__fixtures__',
    'test-project' + (packageManager === 'yarn' ? '' : `-${packageManager}`),
  )

  console.log(`Creating project at ${testProjectPath}`)
  console.log()

  await fs.promises.cp(TEST_PROJECT_FIXTURE_PATH, testProjectPath, {
    recursive: true,
  })

  if (canary) {
    console.log(`Upgrading project to canary`)

    await execInProject(`${cedarCmd} upgrade -t canary`, {
      input: Buffer.from('Y'),
    })

    console.log()
  }

  await execInFramework('yarn project:tarsync --verbose', {
    env: { CEDAR_CWD: testProjectPath },
  })

  console.log('Generating dbAuth secret')
  const { stdout } = await execInProject(`${cedarCmd} g secret --raw`, {
    silent: true,
  })
  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `SESSION_SECRET='${stdout}'`,
  )
  console.log()

  console.log('Running prisma migrate reset')
  await execInProject(`${cedarCmd} prisma migrate reset --force`)

  console.log('Running prisma db seed')
  await execInProject(`${cedarCmd} prisma db seed`)
}
