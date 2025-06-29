#!/usr/bin/env node
/* eslint-env node */

import path from 'path'
import { fileURLToPath } from 'url'

import { $ } from 'zx'

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get the repo root (parent of tasks directory)
const repoRoot = path.resolve(__dirname, '..')

// Save the current working directory
const originalCwd = process.cwd()

// Function to restore original directory
const cleanup = () => {
  process.chdir(originalCwd)
}

// Set up cleanup on exit
process.on('exit', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  cleanup()
  process.exit(1)
})

try {
  console.log(`Original directory: ${originalCwd}`)
  console.log(`Repo root: ${repoRoot}`)

  // Change to repo root
  process.chdir(repoRoot)

  console.log('Running git clean -fdx...')
  await $`git clean -fdx`

  console.log('Running yarn install...')
  await $`yarn install`

  console.log('Running yarn build...')
  await $`yarn build`

  console.log('Installing dependencies in packages/create-cedar-rsc-app...')
  const createCedarRscAppPath = path.join(
    repoRoot,
    'packages/create-cedar-rsc-app',
  )
  process.chdir(createCedarRscAppPath)
  await $`yarn install`

  console.log('All tasks completed successfully!')
  console.log(`Returning to original directory: ${originalCwd}`)
} catch (error) {
  console.error('Error during clean-build process:', error)
  process.exit(1)
}
