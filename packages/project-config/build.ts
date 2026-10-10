import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    bundle: true,
    entryPoints: [
      './src/index.ts',
      './src/packageManager.ts',
      './src/prismaClientOutputDirsWorker.ts',
      './src/prismaClientOutputDirsWorkerUrl.ts',
      './src/workspaces.ts',
    ],
    // Keeps `import.meta` out of the other bundles. See
    // src/prismaClientOutputDirsWorkerUrl.ts
    external: ['./prismaClientOutputDirsWorkerUrl.js'],
    format: 'esm',
    packages: 'external',
  },
})
