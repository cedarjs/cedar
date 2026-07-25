#!/usr/bin/env node

// Deprecated: `rw-web-server` has been renamed to `cedar-web-server`.
// This proxy exists for backward compatibility and will be removed in a future
// major release.

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const webServerPackageJsonPath =
  require.resolve('@cedarjs/web-server/package.json')
const webServerPackageJson = require(webServerPackageJsonPath)

console.warn()
console.warn(
  "'rw-web-server' has been deprecated. Please use 'cedar-web-server' instead.",
)
console.warn()

const bins = webServerPackageJson['bin']
const binPath = path.join(
  path.dirname(webServerPackageJsonPath),
  bins['cedar-web-server'],
)

await import(pathToFileURL(binPath).href)
