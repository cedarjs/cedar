#!/usr/bin/env node

// Deprecated: `rw-log-formatter` has been renamed to `cedar-log-formatter`.
// This proxy exists for backward compatibility and will be removed in a future
// major release.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromApiServer = createRequire(
  require.resolve('@cedarjs/api-server/package.json'),
)

console.warn()
console.warn(
  "'rw-log-formatter' has been deprecated. Please use 'cedar-log-formatter' instead.",
)
console.warn()

const bins = requireFromApiServer('./package.json')['bin']

requireFromApiServer(bins['cedar-log-formatter'])
