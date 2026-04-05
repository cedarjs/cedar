import { build } from '@cedarjs/framework-tools'

await build({
  buildOptions: {
    format: 'esm',
    outdir: 'dist',
  },
})
