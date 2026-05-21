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

  // Verify tarsync produced a lockfile. A missing lockfile means the
  // `yarn install` inside tarsync failed (possibly due to the V8 Maglev JIT
  // crash on Windows). Fail here with a clear message rather than letting the
  // next `yarn cedar g secret --raw` call fail with a confusing
  // "root-workspace not in lockfile" error.
  const yarnLockPath = path.join(testProjectPath, 'yarn.lock')
  if (!fs.existsSync(yarnLockPath)) {
    throw new Error(
      'yarn.lock was not created by tarsync. The yarn install step likely ' +
        'crashed silently (check the tarsync output above for ERROR lines). ' +
        'On Windows this is often caused by the V8 Maglev JIT bug ' +
        '(exit code 0xC0000409 / STATUS_STACK_BUFFER_OVERRUN).',
    )
  }

  const lockfileContent = fs.readFileSync(yarnLockPath, 'utf-8')
  const lines = lockfileContent.split('\n')
  const lineCount =
    lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  console.log(`yarn.lock created (${lineCount} lines)`)
  const rootWorkspaceLine = lines.find((l) => l.startsWith('"root-workspace-'))
  if (rootWorkspaceLine) {
    console.log(`Root workspace entry found: ${rootWorkspaceLine}`)
  } else {
    // The root-workspace entry is required by yarn 4 hardened mode. Without it,
    // any subsequent `yarn cedar ...` invocation will fail with
    // "This package doesn't seem to be present in your lockfile".
    throw new Error(
      'yarn.lock exists but has no root-workspace- entry. ' +
        'The lockfile is incomplete — tarsync may have been interrupted ' +
        'or yarn install may have partially failed.',
    )
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
