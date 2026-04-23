#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromCedarJobs = createRequire(
  require.resolve('@cedarjs/jobs/package.json'),
)

const bins = requireFromCedarJobs('./package.json')['bin']

requireFromCedarJobs(bins['cedar-jobs'])
