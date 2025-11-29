#!/usr/bin/env node
/* eslint-env node */

import path from 'path'
import { fileURLToPath } from 'url'

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

  console.log('Running git clean -fdx...')
  await $`git clean -fdx`

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
