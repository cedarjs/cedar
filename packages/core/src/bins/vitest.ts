#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromVitest = createRequire(require.resolve('vitest/package.json'))

const bin = requireFromVitest('./package.json')['bin']

requireFromVitest(bin)
