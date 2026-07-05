import { build, defaultBuildOptions } from './src/buildDefaults.ts'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    format: 'esm',
  },
})
