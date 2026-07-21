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

  // Convert the project to the target package manager *before* tarsync runs.
  //
  // tarsync detects the project's package manager and installs with it, so
  // converting first means it does the one install we actually want. It used
  // to run against a project that still looked like yarn's, which meant a
  // wasted `yarn install` followed by a second install with the real package
  // manager — and, worse, yarn's hoisted node_modules survived underneath the
  // second one, hiding bugs that only appear in a nested layout.
  //
  // What needs preparing:
  //
  // 1. Set the packageManager field — this is what tarsync detects, and pnpm
  //    refuses to run if it says yarn.
  // 2. Remove yarn.lock, so nothing later mistakes the project for a yarn one.
  // 3. Replace workspace:* protocols with file: references — npm doesn't
  //    understand workspace:*.
  // 4. Pin dependency versions to what the fixture resolved, so that npm/pnpm
  //    don't pick up newer versions (which can change test output like
  //    snapshot serialization).
  //
  // The tarball overrides themselves are tarsync's job — it writes
  // `resolutions`, pnpm `overrides` or npm `overrides` as appropriate.
  if (packageManager !== 'yarn') {
    const pkgPath = path.join(testProjectPath, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

    // This is what tarsync detects, so it has to say the target package
    // manager rather than the fixture's yarn
    pkg.packageManager =
      packageManager === 'pnpm' ? 'pnpm@11.8.0' : 'npm@11.8.0'

    // The fixture pins react-is via yarn's `resolutions`, but npm uses
    // `overrides` instead. Without this override, react-is resolves to 17.x
    // (from pretty-format's dep range), which doesn't properly recognize React
    // 19 elements. This breaks snapshot serialization.
    if (packageManager === 'npm') {
      pkg.overrides = { 'react-is': '19.2.3' }
    }

    if (packageManager === 'pnpm') {
      // Tell pnpm what workspaces we have, what 3rd-party packages are allowed
      // to run build scripts, and what versions of react-is to use (see also
      // npm comment above)

      pkg.engines = {
        ...pkg.engines,
        pnpm: '>=11.8.0 <12.0.0',
      }

      pkg.devEngines = {
        packageManager: {
          name: 'pnpm',
          version: '11.8.0',
          onFail: 'download',
        },
      }

      // Note there are no tarball overrides here — tarsync appends those to
      // this file's `overrides` block once it has built them
      const yaml = [
        // The `overrides` below only redirect dependencies that are *declared*
        // in a package.json. Peers that pnpm auto-installs are resolved
        // straight from the registry, bypassing them — so `@cedarjs/auth`,
        // `@cedarjs/graphql-server`, `@cedarjs/router` and `@cedarjs/web` were
        // getting installed twice: once from the local tarball and once as the
        // last published release. Framework packages that take those as peers
        // (`@cedarjs/testing`, most importantly) then linked against the
        // *published* copy, so the smoke test silently ran published code
        // instead of the code being tested. Turning the auto-install off
        // leaves the tarballs as the only copy. yarn/npm don't do this, which
        // is why only pnpm was affected
        'autoInstallPeers: false',
        '',
        'packages:',
        '  - api',
        '  - web',
        '  - packages/*',
        '',
        'allowBuilds:',
        "  '@clerk/shared': false",
        "  '@firebase/util': true",
        "  '@prisma/client': false",
        "  '@prisma/engines': true",
        "  '@swc/core': true",
        '  better-sqlite3: true',
        '  core-js: false',
        '  core-js-pure: false',
        '  esbuild: true',
        '  msw: true',
        '  prisma: false',
        '  protobufjs: false',
        '  unrs-resolver: false',
        '',
        'overrides:',
        "  'react-is': '19.2.3'",
        '',
      ].join('\n')

      fs.writeFileSync(path.join(testProjectPath, 'pnpm-workspace.yaml'), yaml)
    }

    if (packageManager === 'npm') {
      // The test-project fixture uses workspace:* for internal workspace
      // packages like @my-org/validators. npm doesn't support workspace:*
      // protocol, so replace with file: references across all
      // package.json files in the project.
      const pkgJsonFiles = [
        'package.json',
        'api/package.json',
        'web/package.json',
      ]

      for (const relPath of pkgJsonFiles) {
        const fullPath = path.join(testProjectPath, relPath)
        if (!fs.existsSync(fullPath)) {
          continue
        }

        // Reuse the already-parsed root `pkg` for the root file.
        const pkgFile =
          relPath === 'package.json'
            ? pkg
            : JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

        for (const deps of [pkgFile.dependencies, pkgFile.devDependencies]) {
          for (const [name, version] of Object.entries(deps || {})) {
            if (version === 'workspace:*') {
              const bareName = name.startsWith('@') ? name.split('/')[1] : name
              deps[name] = `file:packages/${bareName}`
              console.log(`  ${name}: workspace:* → file:packages/${bareName}`)
            }
          }
        }

        fs.writeFileSync(fullPath, JSON.stringify(pkgFile, null, 2) + '\n')
      }
    } else {
      // pnpm — just write the root with updated fields
      // (the pnpm overrides for react-is were set above alongside npm's)
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    }

    console.log(
      `Updated packageManager field to "${packageManager}"` +
        (packageManager === 'npm' ? ', replaced workspace:* → file:' : ''),
    )

    // The fixture ships a yarn.lock. Leaving it in place would both confuse
    // tarsync's detection and let a yarn-shaped tree leak into the install
    await fs.promises.rm(path.join(testProjectPath, 'yarn.lock'), {
      force: true,
    })

    console.log()
  }

  // tarsync builds the framework tarballs, copies them into the project,
  // points the project's overrides at them (`resolutions` for yarn, `overrides`
  // for npm and pnpm) and then installs with the project's own package
  // manager — which the conversion above has already set
  await execInFramework('yarn project:tarsync --verbose', {
    env: { CEDAR_CWD: testProjectPath },
  })

  if (packageManager === 'yarn') {
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

  if (packageManager === 'pnpm') {
    // Update the seed command in prisma.config.cjs
    const prismaConfigPath = path.join(
      testProjectPath,
      'api',
      'prisma.config.cjs',
    )
    const prismaConfigContent = fs.readFileSync(prismaConfigPath, 'utf-8')
    const updatedContent = prismaConfigContent.replace(
      /seed:\s*'yarn cedar exec seed'/,
      "seed: 'pnpm cedar exec seed'",
    )
    fs.writeFileSync(prismaConfigPath, updatedContent)
  }

  console.log('Running prisma migrate reset')
  await execInProject(`${cedar} prisma migrate reset --force`)

  console.log('Running prisma db seed')
  await execInProject(`${cedar} prisma db seed`)
}
