#!/usr/bin/env node

// Deprecated: `rw-jobs-worker` has been renamed to `cedar-jobs-worker`.
// This file exists for backward compatibility and will be removed in a future
// major release.

console.warn()
console.warn(
  "'rw-jobs-worker' has been deprecated. Please use 'cedar-jobs-worker' instead.",
)
console.warn()

require('./cedar-jobs-worker.js')
