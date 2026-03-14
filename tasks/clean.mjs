#!/usr/bin/env node
/* eslint-env node */

import { rimraf } from 'rimraf'

await rimraf('packages/**/dist', {
  glob: {
    ignore: 'packages/**/{fixtures,__fixtures__,node_modules}/**/dist',
  },
})

// Remove all `tsconfig.tsbuildinfo` files.
await rimraf('packages/**/tsconfig.tsbuildinfo', {
  glob: true,
})

await rimraf('packages/**/tsconfig.build.tsbuildinfo', {
  glob: true,
})

await rimraf('packages/**/tsconfig.cjs.tsbuildinfo', {
  glob: true,
})
