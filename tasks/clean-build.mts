#!/usr/bin/env node

import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { $, question } from 'zx'

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get the repo root (parent of tasks directory)
const repoRoot = path.resolve(__dirname, '..')

const originalCwd = process.cwd()

const restoreCwd = () => {
  process.chdir(originalCwd)
}

process.on('exit', restoreCwd)
process.on('SIGINT', restoreCwd)
process.on('SIGTERM', restoreCwd)
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  restoreCwd()
  process.exit(1)
})

try {
  console.log(`Original directory: ${originalCwd}`)
  console.log(`Repo root: ${repoRoot}`)

  process.chdir(repoRoot)

  await promptForUntrackedFiles()

  // Explicitly remove node_modules before git clean because `git clean -fdx`
  // can fail with "Directory not empty" when it tries to rmdir node_modules/
  // after deleting its contents. We're specifically seeing this with the
  // GraphQL language server that uses jiti to read TypeScript config files and
  // cache transpiled results to node_modules/.cache/jiti. This background
  // process, and other similar ones, can recreate subdirectories while git is
  // trying to delete other files inside node_modules causing ENOTEMPTY. Using
  // the shell rm -rf avoids this race condition entirely.
  // On Windows we fall back to the PowerShell equivalent.
  // For me the exact sequence is:
  // 1. Zed's GraphQL language server is running when I have the project open
  // 2. It uses `graphql-language-service-cli` → `graphql-config` → `jiti` to
  //    read the GraphQL config
  // 3. jiti writes its transpile cache to `node_modules/.cache/jiti/`
  // 4. I run `build:clean`, which tries to "git clean"
  // 5. The Zed GraphQL server is still running and has file handles or is
  //    actively writing to `.cache/jiti/`
  // 6. The "git clean" fails with `ENOTEMPTY`
  //
  // The workaround is to use the OS's native `rm -fr` command
  console.log('Removing node_modules...')
  const nodeModulesPath = path.join(repoRoot, 'node_modules')
  if (platform() === 'win32') {
    await $`powershell -Command "if (Test-Path '${nodeModulesPath}') { Remove-Item -Recurse -Force '${nodeModulesPath}' }"`
  } else {
    await $`rm -rf ${nodeModulesPath}`
  }

  console.log('Running git clean -fdx...')
  await $`git clean -fdx --exclude='/test-project/'`

  console.log('Running yarn install...')
  await $`yarn install`

  console.log('Running yarn install in packages/create-cedar-rsc-app...')
  const createCedarRscAppPath = path.join(
    repoRoot,
    'packages/create-cedar-rsc-app',
  )
  await $({ cwd: createCedarRscAppPath })`yarn install`

  console.log('Running yarn install in docs...')
  await $({ cwd: path.join(repoRoot, 'docs') })`yarn install`

  // This step triggers Node's DEP0169 warning. But it's not our fault.
  // See https://github.com/nrwl/nx/issues/33894
  // TODO: Remove comment above when the issue is fixed
  console.log('Running yarn build...')
  await $`yarn build`

  console.log('All tasks completed successfully!')
  console.log(`Returning to original directory: ${originalCwd}`)
  process.chdir(originalCwd)
} catch (error) {
  console.error('Error during clean-build process:', error)
  process.exit(1)
}

async function promptForUntrackedFiles() {
  console.log('Checking for untracked files...')
  const statusResult =
    await $`git status --porcelain --untracked-files=all`.quiet()
  const untrackedFiles = statusResult.stdout
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.substring(3))
    .filter((file) => file.trim())

  if (untrackedFiles.length > 0) {
    console.log(
      `\n⚠️  WARNING: git clean -fdx will delete ${untrackedFiles.length} ` +
        'untracked files/directories:',
    )

    if (untrackedFiles.length <= 5) {
      untrackedFiles.forEach((file) => {
        console.log(`  - ${file}`)
      })
    } else {
      console.log(
        `  (${untrackedFiles.length} files/directories - too many to list)`,
      )
    }

    const confirmed = await question('\nDo you want to proceed? (y/N): ')
    if (!confirmed || !['y', 'yes'].includes(confirmed.toLowerCase())) {
      console.log('Operation cancelled.')
      process.exit(0)
    }
  }
}
