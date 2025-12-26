#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromVitest = createRequire(require.resolve('vitest/package.json'))

const bin = requireFromVitest('./package.json')['bin']

// Support both
// {
//   bin: {
//     vitest: './dist/cli.mjs'
//   }
// }
// and
// {
//   bin: './dist/cli.mjs'
// }
requireFromVitest(bin['vitest'] || bin)
