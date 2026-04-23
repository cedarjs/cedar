#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('@cedarjs/vite/package.json')
const vitePackageJsonFileUrl = pathToFileURL(pkgPath)
const requireFromRxVite = createRequire(vitePackageJsonFileUrl)
const bins = requireFromRxVite('./package.json')['bin']
const viteEntryPointUrl = new URL(bins['cedar-dev-fe'], vitePackageJsonFileUrl)

import(viteEntryPointUrl.toString())
