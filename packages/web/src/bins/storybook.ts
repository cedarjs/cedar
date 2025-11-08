#!/usr/bin/env node

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

function isErrorWithCode(error: unknown): error is { code: string } {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

const pkgJsonPath = require.resolve('storybook/package.json')
const storybookPackageJsonFileUrl = pathToFileURL(pkgJsonPath)

// We do not install storybook by default, so we need to check if it is
// installed before we try to run it.
try {
  const requireFromStorybook = createRequire(storybookPackageJsonFileUrl)
  const bin = requireFromStorybook('./package.json')['bin']
  const sbEntryPointUrl = new URL(bin, storybookPackageJsonFileUrl)

  // If this is defined, we're running through yarn and need to change the cwd.
  // See https://yarnpkg.com/advanced/lifecycle-scripts/#environment-variables.
  if (process.env.PROJECT_CWD) {
    process.chdir(process.env.PROJECT_CWD)
  }

  import(sbEntryPointUrl.toString())
} catch (error) {
  if (isErrorWithCode(error) && error.code === 'MODULE_NOT_FOUND') {
    console.error('Storybook is not currently installed.')
    process.exit(1)
  }

  throw error
}
