#!/usr/bin/env node

/**
 * This file lets users run the Redmix CLI commands inside the /api directory
 * in their projects.
 * This works because of the "bin" field in the @redmix/api package.json file
 * that points to this file.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const cliPackageJsonFileUrl = pathToFileURL(
  require.resolve('@redmix/cli/package.json'),
)

const requireFromCli = createRequire(cliPackageJsonFileUrl)
const bins = requireFromCli('./package.json')['bin']
const cliEntryPointUrl = new URL(bins['redwood'], cliPackageJsonFileUrl)

// If this is defined, we're running through yarn and need to change the cwd.
// See https://yarnpkg.com/advanced/lifecycle-scripts/#environment-variables.
if (process.env.PROJECT_CWD) {
  process.chdir(process.env.PROJECT_CWD)
}

import(cliEntryPointUrl.toString())
