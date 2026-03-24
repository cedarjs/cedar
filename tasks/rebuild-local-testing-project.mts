#!/usr/bin/env node

/**
 * Rebuilds the root /local-testing-project folder from the
 * __fixtures__/test-project fixture, with local "file:" resolutions pointing at
 * the built .tgz packages.
 *
 * Steps:
 *  1. yarn build:clean && yarn build:pack
 *  2. yarn rebuild-test-project-fixture
 *  3. Delete contents of /local-testing-project
 *  4. Copy all files from /__fixtures__/test-project
 *  5. Update /local-testing-project/package.json with file: resolutions
 *  6. Copy .env template and append SESSION_SECRET
 *  7. yarn install, yarn cedar prisma migrate dev, yarn cedar prisma db seed,
 *     yarn cedar prisma generate
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

const argv = yargs(hideBin(process.argv))
  .option('packageManager', {
    alias: 'pm',
    type: 'string',
    choices: ['yarn', 'npm', 'pnpm'],
    default: 'yarn',
  })
  .parseSync()

const packageManager = argv.packageManager as 'yarn' | 'npm' | 'pnpm'

const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURE_PATH = path.join(FRAMEWORK_ROOT, '__fixtures__', 'test-project')
const TEST_PROJECT_PATH = path.join(FRAMEWORK_ROOT, 'local-testing-project')
const PACKAGES_PATH = path.join(FRAMEWORK_ROOT, 'packages')
const ENV_TEMPLATE_PATH = path.join(
  FRAMEWORK_ROOT,
  'packages',
  'create-cedar-app',
  'templates',
  'ts',
  '.env',
)

const SESSION_SECRET_APPEND = `
# Used to encrypt/decrypt session cookies. Change this value and re-deploy to
# log out all users of your app at once.
SESSION_SECRET=pe+111111111111111111111111111111111111111111=
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd: string = FRAMEWORK_ROOT): void {
  console.log(`\n> ${cmd}  (cwd: ${cwd})`)
  try {
    execSync(cmd, { cwd, stdio: 'inherit' })
  } catch (err: unknown) {
    // Exit code 2 from build:clean means the user declined the prompt.
    // Re-throw a typed sentinel so main() can exit cleanly.
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof err.status === 'number' &&
      err.status === 2
    ) {
      throw new UserCancelledError(err.status)
    }

    throw err
  }
}

class UserCancelledError extends Error {
  exitCode: number

  constructor(exitCode: number) {
    super('Cancelled by user.')
    this.name = 'UserCancelledError'
    this.exitCode = exitCode
  }
}

/**
 * Recursively delete all direct children of a directory (but keep the dir).
 * Entries listed in `preserve` (bare filenames) are left untouched.
 */
function clearDirectory(dir: string, preserve: string[] = []): void {
  if (!fs.existsSync(dir)) {
    return
  }

  for (const entry of fs.readdirSync(dir)) {
    if (preserve.includes(entry)) {
      continue
    }

    const fullPath = path.join(dir, entry)
    fs.rmSync(fullPath, { recursive: true, force: true })
  }
}

/**
 * Walk the packages directory and collect every .tgz file, then map each
 * one's package name -> relative file: path (relative to test-project/).
 */
function buildTgzResolutions(): Record<string, string> {
  const resolutions: Record<string, string> = {}

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          walk(fullPath)
        }
      } else if (entry.isFile() && entry.name.endsWith('.tgz')) {
        const packageJsonPath = path.join(dir, 'package.json')

        if (!fs.existsSync(packageJsonPath)) {
          continue
        }

        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8'),
        ) as { name?: string }

        if (!packageJson.name) {
          continue
        }

        // Path relative to the test-project folder.
        // Replace backslashes with forward slashes so the file: resolution is
        // valid on Windows too. Yarn Berry requires forward slashes in paths.
        const relPath = path
          .relative(TEST_PROJECT_PATH, fullPath)
          .replaceAll('\\', '/')
        resolutions[packageJson.name] = `file:${relPath}`
      }
    }
  }

  walk(PACKAGES_PATH)
  return resolutions
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

function buildPackages(): void {
  console.log('\n=== Step 1: build:clean && build:pack ===')
  run('yarn build:clean')
  run('yarn build:pack')
}

function rebuildFixture(): void {
  console.log('\n=== Step 2: rebuild-test-project-fixture ===')
  run(`yarn rebuild-test-project-fixture --packageManager ${packageManager}`)
}

function clearTestProject(): void {
  console.log('\n=== Step 3: Clearing /test-project ===')
  clearDirectory(TEST_PROJECT_PATH, ['README.md'])
  console.log(`Cleared ${TEST_PROJECT_PATH} (preserved README.md)`)
}

function copyFixture(): void {
  console.log('\n=== Step 4: Copying __fixtures__/test-project ===')
  // force: false + errorOnExist: false means existing files (e.g. README.md)
  // are silently skipped rather than overwritten or errored on.
  fs.cpSync(FIXTURE_PATH, TEST_PROJECT_PATH, {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
  console.log(`Copied ${FIXTURE_PATH} -> ${TEST_PROJECT_PATH}`)
}

function updatePackageJson(): void {
  console.log(
    '\n=== Step 5: Updating test-project/package.json resolutions ===',
  )

  const packageJsonPath = path.join(TEST_PROJECT_PATH, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    resolutions?: Record<string, string>
    [key: string]: unknown
  }

  const tgzResolutions = buildTgzResolutions()

  if (!packageJson.resolutions) {
    packageJson.resolutions = {}
  }

  // Preserve any non-tgz resolutions that are already present (e.g. react-is)
  // and merge in the newly discovered file: resolutions.
  for (const [pkgName, filePath] of Object.entries(tgzResolutions)) {
    packageJson.resolutions[pkgName] = filePath
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
  console.log(`Updated ${packageJsonPath}`)
  console.log(`  Added ${Object.keys(tgzResolutions).length} file: resolutions`)
}

function copyEnvFile(): void {
  console.log('\n=== Step 6: Copying .env and appending SESSION_SECRET ===')

  const destEnvPath = path.join(TEST_PROJECT_PATH, '.env')
  const templateContent = fs.readFileSync(ENV_TEMPLATE_PATH, 'utf8')
  const finalContent = templateContent + SESSION_SECRET_APPEND

  fs.writeFileSync(destEnvPath, finalContent)
  console.log(`Written ${destEnvPath}`)
}

function installAndMigrate(): void {
  console.log(`\n=== Step 7: ${packageManager} install and prisma setup ===`)

  // An empty lock file must exist before installation so the package manager
  // treats the test-project as its own independent workspace root rather than
  // walking up to the monorepo root and merging lock files.
  const lockFiles = {
    yarn: 'yarn.lock',
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
  }
  const lockPath = path.join(TEST_PROJECT_PATH, lockFiles[packageManager])
  fs.writeFileSync(lockPath, '')
  console.log(`Created empty ${lockPath}`)

  const installCmd = `${packageManager} install`
  const cedarCmd =
    packageManager === 'npm' ? 'npx cedar' : `${packageManager} cedar`

  run(installCmd, TEST_PROJECT_PATH)
  run(`${cedarCmd} prisma migrate dev`, TEST_PROJECT_PATH)
  run(`${cedarCmd} prisma db seed`, TEST_PROJECT_PATH)
  run(`${cedarCmd} prisma generate`, TEST_PROJECT_PATH)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const hr = '='.repeat(60)

  console.log(hr)
  console.log('Rebuilding /test-project')
  console.log(hr)

  buildPackages()
  rebuildFixture()
  clearTestProject()
  copyFixture()
  updatePackageJson()
  copyEnvFile()
  installAndMigrate()

  const durationMs = Date.now() - startTime
  const durationMin = Math.floor(durationMs / 60000)
  const durationSec = ((durationMs / 1000) % 60).toFixed(1)

  console.log()
  console.log(hr)
  console.log(`Done! Total time: ${durationMin}m${durationSec}s`)
  console.log(hr)
}

main().catch((err: unknown) => {
  if (err instanceof UserCancelledError) {
    console.log('\nRebuild cancelled.')
    process.exit(err.exitCode)
  }

  console.error('rebuild-test-project failed:', err)
  process.exit(1)
})
