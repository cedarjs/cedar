#!/usr/bin/env node

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

function isErrorWithCode(error: any): error is { code: string } {
  return error.code !== undefined
}

const storybookPackageJsonFileUrl = pathToFileURL(
  require.resolve('storybook-framework-redmix-vite/package.json'),
)

// We do not install storybook by default, so we need to check if it is
// installed before we try to run it.
try {
  const requireFromStorybook = createRequire(storybookPackageJsonFileUrl)
  const bins = requireFromStorybook('./package.json')['bin']
  const sbEntryPointUrl = new URL(bins['rwfw'], storybookPackageJsonFileUrl)

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
