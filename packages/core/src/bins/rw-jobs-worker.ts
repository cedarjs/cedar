#!/usr/bin/env node

// Deprecated: `rw-jobs-worker` has been renamed to `cedar-jobs-worker`.
// This proxy exists for backward compatibility and will be removed in a future
// major release.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromJobs = createRequire(
  require.resolve('@cedarjs/jobs/package.json'),
)

console.warn()
console.warn(
  "'rw-jobs-worker' has been deprecated. Please use 'cedar-jobs-worker' instead.",
)
console.warn()

const bins = requireFromJobs('./package.json')['bin']

requireFromJobs(bins['cedar-jobs-worker'])
