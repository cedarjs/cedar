import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    bundle: true,
    entryPoints: [
      './src/index.ts',
      './src/packageManager.ts',
      './src/prismaClientOutputDirsWorker.ts',
      './src/workspaces.ts',
    ],
    format: 'esm',
    packages: 'external',
  },
})
