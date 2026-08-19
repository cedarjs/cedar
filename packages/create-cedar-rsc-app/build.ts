import { build, defaultBuildOptions } from './framework-tools.ts'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    target: ['node16'],
    format: 'esm',
    packages: 'external',
  },
})
