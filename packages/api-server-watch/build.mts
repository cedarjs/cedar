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
//
// `import.meta.url` is always a well-formed `file://` URL, but naively
// building one from `process.argv[1]` is not: on Windows argv paths use `\`
// and have no scheme, so `file://${process.argv[1]}` produces something
// like `file://C:\Users\...`, which can never equal `import.meta.url` — the
// guard would silently never run the watcher on Windows. `pathToFileURL`
// normalizes both platforms' paths into the same URL shape. The import is
// spliced in alongside the guard, rather than added to watch.ts's own
// imports, because ES module imports hoist regardless of where in the file
// they appear, and this one is only needed by the injected guard, not by
// anything in the source file.
//
// `process.argv[1]` is checked first because it isn't always set — a
// scriptless invocation like `node -e "await import(...)"` has no entry
// script, so it's `undefined`, and `pathToFileURL(undefined)` throws. That
// would crash the module just from being imported, before a consumer ever
// gets to call `startWatch`. When there's no script path this clearly isn't
// a direct-execution invocation, so the guard can just say so without
// attempting the conversion.
const builtEsmWatchPath = path.join(import.meta.dirname, 'dist/watch.js')
const builtEsmWatch = fs.readFileSync(builtEsmWatchPath, 'utf8')
fs.writeFileSync(
  builtEsmWatchPath,
  builtEsmWatch.replace(
    /^startWatch\(\);$/m,
    "import { pathToFileURL } from 'node:url'\n" +
      'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {\n  startWatch();\n}',
  ),
)
