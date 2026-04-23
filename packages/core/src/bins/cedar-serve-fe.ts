#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromRwVite = createRequire(
  require.resolve('@cedarjs/vite/package.json'),
)

const bins = requireFromRwVite('./package.json')['bin']

requireFromRwVite(bins['cedar-serve-fe'])
