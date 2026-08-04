import fs from 'node:fs'
import path from 'node:path'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

// Build the main package as ESM (everything except the watch.ts bin, which is
// bundled separately below)
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, './src/watch.ts'],
  },
})
await generateTypesEsm()

// Build the cedar-api-server-watch bin
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    banner: {
      js: '#!/usr/bin/env node',
    },
    bundle: true,
    packages: 'external',
    entryPoints: ['./src/watch.ts'],
  },
  metafileName: 'meta.esm.watch.json',
})

// watch.ts ends with a bare `startWatch()` call so it runs both as a script
// and as an importable module. Guard the call so importing it (as
// @cedarjs/core's bin wrappers do) doesn't start a second watcher.
const builtEsmWatchPath = path.join(import.meta.dirname, 'dist/watch.js')
const builtEsmWatch = fs.readFileSync(builtEsmWatchPath, 'utf8')
fs.writeFileSync(
  builtEsmWatchPath,
  builtEsmWatch.replace(
    /^startWatch\(\);$/m,
    'if (import.meta.url === `file://${process.argv[1]}`) {\n  startWatch();\n}',
  ),
)
