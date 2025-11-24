import fs from 'node:fs'
import path from 'node:path'

import type { BuildOptions as ESBuildOptions, Plugin } from 'esbuild'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import {
  generateTypesCjs,
  generateTypesEsm,
  insertCommonJsPackageJson,
} from '@cedarjs/framework-tools/generateTypes'

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

function dirnameInjectorPlugin(): Plugin {
  return {
    name: '__dirname injector',
    setup(build) {
      build.onLoad({ filter: /.*/ }, async ({ path: filePath }) => {
        const originalContents = await fs.promises.readFile(filePath, 'utf8')
        const contents = originalContents.replaceAll(
          'import.meta.dirname',
          '__dirname',
        )

        return {
          contents,
          loader: path.extname(filePath) === '.ts' ? 'ts' : 'js',
        }
      })
    },
  }
}

// Build the main package as CJS
await build({
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.cjs.json',
    outdir: 'dist/cjs',
    packages: 'external',
    plugins: [dirnameInjectorPlugin()],
  },
  entryPointOptions: {
    ignore: ignorePatterns,
  },
})
await generateTypesCjs()

await insertCommonJsPackageJson({ buildFileUrl: import.meta.url })

// Build the cedarjs-server and rw-server bins
await buildBinEsm({
  buildOptions: {
    entryPoints: ['./src/bin.ts'],
  },
})
await buildBinCjs({
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
await buildBinCjs({
  buildOptions: {
    entryPoints: ['./src/logFormatter/bin.ts'],
    outdir: './dist/cjs/logFormatter',
  },
})

// Build the watch bin
await buildBinEsm({
  buildOptions: {
    entryPoints: ['./src/watch.ts'],
  },
})
await buildBinCjs({
  buildOptions: {
    entryPoints: ['./src/watch.ts'],
  },
})

async function buildBinEsm({ buildOptions }: { buildOptions: ESBuildOptions }) {
  await buildBin({
    buildOptions: {
      tsconfig: 'tsconfig.build.json',
      format: 'esm',
      ...buildOptions,
    },
  })
}

async function buildBinCjs({ buildOptions }: { buildOptions: ESBuildOptions }) {
  await buildBin({
    buildOptions: {
      tsconfig: 'tsconfig.cjs.json',
      outdir: './dist/cjs',
      plugins: [dirnameInjectorPlugin()],
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
