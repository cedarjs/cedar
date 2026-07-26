import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

await build({
  buildOptions: {
    ...defaultBuildOptions,
    format: 'cjs',
  },
})
