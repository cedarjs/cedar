import fs from 'node:fs'
import path from 'node:path'

import type { BuildOptions as ESBuildOptions } from 'esbuild'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

const ignorePatterns = [
  ...defaultIgnorePatterns,
  './src/bin.ts',
  './src/logFormatter/bin.ts',
  './src/types.ts',
  './src/watch.ts',
]

// Build the main package as ESM
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
  entryPointOptions: {
    ignore: ignorePatterns,
  },
})
await generateTypesEsm()

// Build the cedarjs-server bin
await buildBinEsm({
  buildOptions: {
    entryPoints: ['./src/bin.ts'],
  },
})

// Build the logFormatter bin
await buildBinEsm({
  buildOptions: {
    entryPoints: ['./src/logFormatter/bin.ts'],
    outdir: './dist/logFormatter',
  },
})

// Build the watch bin
await buildBinEsm({
  buildOptions: {
    entryPoints: ['./src/watch.ts'],
  },
})

const builtEsmWatchPath = path.join(import.meta.dirname, 'dist/watch.js')
const builtEsmWatch = fs.readFileSync(builtEsmWatchPath, 'utf8')
fs.writeFileSync(
  builtEsmWatchPath,
  builtEsmWatch.replace(
    /^startWatch\(\);$/m,
    'if (import.meta.url === `file://${process.argv[1]}`) {\n  startWatch();\n}',
  ),
)

async function buildBinEsm({ buildOptions }: { buildOptions: ESBuildOptions }) {
  await buildBin({
    buildOptions: {
      tsconfig: 'tsconfig.build.json',
      format: 'esm',
      ...buildOptions,
    },
  })
}

async function buildBin({ buildOptions }: { buildOptions: ESBuildOptions }) {
  const entryPoints = buildOptions.entryPoints
  if (!Array.isArray(entryPoints) || typeof entryPoints[0] !== 'string') {
    throw new Error('Invalid entry points')
  }

  const metafileName = (entryPoints[0] || '')
    .replace('./src/', 'meta.' + buildOptions.format + '.')
    .replaceAll('/', '_')
    .replace('.ts', '.json')

  await build({
    buildOptions: {
      ...defaultBuildOptions,
      banner: {
        js: '#!/usr/bin/env node',
      },
      bundle: true,
      packages: 'external',
      ...buildOptions,
    },
    metafileName,
  })
}
