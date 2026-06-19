import fs from 'node:fs'
import path from 'node:path'

import type { PackageManager } from '@cedarjs/project-config/packageManager'

function cedarPrefix(pm: PackageManager): string {
  if (pm === 'npm') {
    return 'npx cedar'
  }

  if (pm === 'pnpm') {
    return 'pnpm cedar'
  }

  return 'yarn cedar'
}

function lockfileName(pm: PackageManager): string {
  if (pm === 'npm') {
    return 'package-lock.json'
  }

  if (pm === 'pnpm') {
    return 'pnpm-lock.yaml'
  }

  return 'yarn.lock'
}

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
  packageManager?: PackageManager
}

export async function setUpTestProject({
  setOutput,
  getInput,
  createExecWithEnvInCwd,
  execInFramework,
  cedarFrameworkPath,
  testProjectPath,
  packageManager = 'yarn',
}: Args) {
  const execInProject = createExecWithEnvInCwd(testProjectPath)

  setOutput('test-project-path', testProjectPath)

  const canary = getInput('canary') === 'true'
  console.log({ canary })
  console.log({ packageManager })

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

  // tarsync is yarn-based (the framework monorepo uses yarn). It copies
  // framework packages into the project and runs `yarn install`, producing
  // yarn.lock + node_modules. This works for all PMs because node_modules
  // makes the `cedar` binary available regardless of which PM is configured.
  await execInFramework('yarn project:tarsync --verbose', {
    env: { CEDAR_CWD: testProjectPath },
  })

  // For npm/pnpm: run the project's own install to create the correct
  // lockfile and node_modules layout. Before doing so, prepare the project
  // so the install doesn't fail:
  //
  // 1. Update the packageManager field — pnpm reads it and refuses if it
  //    says yarn.
  // 2. Replace workspace:* protocols with file: references — npm doesn't
  //    understand workspace:*.
  if (packageManager !== 'yarn') {
    const pkgPath = path.join(testProjectPath, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

    pkg.packageManager = packageManager

    if (packageManager === 'npm') {
      // The test-project fixture uses workspace:* for internal workspace
      // packages like @my-org/validators in api/ and web/. npm doesn't
      // support workspace:* protocol, so replace with file: references
      // across all package.json files in the project.
      const pkgJsonFiles = [
        'package.json',
        'api/package.json',
        'web/package.json',
      ]

      for (const pkgJsonPath of pkgJsonFiles) {
        const fullPath = path.join(testProjectPath, pkgJsonPath)
        if (!fs.existsSync(fullPath)) {
          continue
        }

        const pkgFile = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

        for (const deps of [pkgFile.dependencies, pkgFile.devDependencies]) {
          if (!deps) {
            continue
          }
          for (const [name, version] of Object.entries(deps)) {
            if (version === 'workspace:*') {
              const bareName = name.startsWith('@') ? name.split('/')[1] : name
              deps[name] = `file:packages/${bareName}`
              console.log(`  ${name}: workspace:* → file:packages/${bareName}`)
            }
          }
        }

        fs.writeFileSync(fullPath, JSON.stringify(pkgFile, null, 2) + '\n')
      }
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    console.log(
      `Updated packageManager field to "${packageManager}"` +
        (packageManager === 'npm' ? ', replaced workspace:* → file:' : ''),
    )
    console.log()
    console.log(
      `Running ${packageManager} install to create ${lockfileName(packageManager)}`,
    )

    await execInProject(`${packageManager} install`)

    console.log()
  } else {
    // Verify tarsync produced a yarn.lock. A missing lockfile means the
    // `yarn install` inside tarsync failed (possibly due to the V8 Maglev JIT
    // crash on Windows). Fail here with a clear message rather than letting
    // the next `yarn cedar g secret --raw` call fail with a confusing
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

    const rootWorkspaceLine = lines.find((l) =>
      l.startsWith('"root-workspace-'),
    )

    if (rootWorkspaceLine) {
      console.log(`Root workspace entry found: ${rootWorkspaceLine}`)
    } else {
      // The root-workspace entry is required by yarn 4 hardened mode. Without
      // it, any subsequent `yarn cedar ...` invocation will fail with
      // "This package doesn't seem to be present in your lockfile".
      throw new Error(
        'yarn.lock exists but has no root-workspace- entry. ' +
          'The lockfile is incomplete — tarsync may have been interrupted ' +
          'or yarn install may have partially failed.',
      )
    }
  }

  const cedar = cedarPrefix(packageManager)

  if (canary) {
    console.log('Upgrading project to canary')

    await execInProject(`${cedar} upgrade -t canary`)

    console.log()
  }

  console.log('Generating dbAuth secret')

  const secretResult = await execInProject(`${cedar} g secret --raw`, {
    silent: true,
    ignoreReturnCode: true,
  })

  if (secretResult.exitCode !== 0) {
    console.error(
      `${cedar} g secret --raw failed with exit code ${secretResult.exitCode}`,
    )
    console.error('stdout:', secretResult.stdout || '(empty)')
    console.error('stderr:', secretResult.stderr || '(empty)')

    throw new Error(
      `${cedar} g secret --raw failed with exit code ${secretResult.exitCode}`,
    )
  }

  fs.appendFileSync(
    path.join(testProjectPath, '.env'),
    `\nSESSION_SECRET='${secretResult.stdout}'\n`,
  )

  console.log()

  console.log('Running prisma migrate reset')
  await execInProject(`${cedar} prisma migrate reset --force`)

  console.log('Running prisma db seed')
  await execInProject(`${cedar} prisma db seed`)
}
