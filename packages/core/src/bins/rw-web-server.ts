#!/usr/bin/env node

// Deprecated: `rw-web-server` has been renamed to `cedar-web-server`.
// This proxy exists for backward compatibility and will be removed in a future
// major release.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromWebServer = createRequire(
  require.resolve('@cedarjs/web-server/package.json'),
)

console.warn()
console.warn(
  "'rw-web-server' has been deprecated. Please use 'cedar-web-server' instead.",
)
console.warn()

const bins = requireFromWebServer('./package.json')['bin']

requireFromWebServer(bins['cedar-web-server'])
