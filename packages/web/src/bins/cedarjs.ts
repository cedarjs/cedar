#!/usr/bin/env node

/**
 * This file lets users run the Cedar CLI commands inside the /web directory
 * in their projects.
 * This works because of the "bin" field in the @cedarjs/web package.json file
 * that points to this file.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const cliPackageJsonFileUrl = pathToFileURL(
  require.resolve('@cedarjs/cli/package.json'),
)

const requireFromCli = createRequire(cliPackageJsonFileUrl)
const bins = requireFromCli('./package.json')['bin']
const cliEntryPointUrl = new URL(bins['cedarjs'], cliPackageJsonFileUrl)

// If this is defined, we're running through yarn and need to change the cwd.
// See https://yarnpkg.com/advanced/lifecycle-scripts/#environment-variables.
if (process.env.PROJECT_CWD) {
  process.chdir(process.env.PROJECT_CWD)
}

import(cliEntryPointUrl.toString())
