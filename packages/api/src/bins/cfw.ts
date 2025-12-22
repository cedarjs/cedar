#!/usr/bin/env node

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const cliPackageJsonFileUrl = pathToFileURL(
  require.resolve('@cedarjs/cli/package.json'),
)

const requireFromCli = createRequire(cliPackageJsonFileUrl)
const bins = requireFromCli('./package.json')['bin']
const cliEntryPointUrl = new URL(bins['cfw'], cliPackageJsonFileUrl)

// If this is defined, we're running through yarn and need to change the cwd.
// See https://yarnpkg.com/advanced/lifecycle-scripts/#environment-variables.
if (process.env.PROJECT_CWD) {
  process.chdir(process.env.PROJECT_CWD)
}

import(cliEntryPointUrl.toString())
