#!/usr/bin/env node

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve('@redmix/cli/package.json')
const cliPackageJsonFileUrl = pathToFileURL(pkgJsonPath)
const requireFromCli = createRequire(cliPackageJsonFileUrl)
const bins = requireFromCli('./package.json')['bin']
const cliEntryPointUrl = new URL(bins['rwfw'], cliPackageJsonFileUrl)

import(cliEntryPointUrl.toString())
