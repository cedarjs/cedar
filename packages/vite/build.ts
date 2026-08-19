import { commonjs } from '@hyrious/esbuild-plugin-commonjs'
import * as esbuild from 'esbuild'

import {
  build,
  defaultBuildOptions,
  defaultIgnorePatterns,
} from '@cedarjs/framework-tools'
import { generateTypesEsm } from '@cedarjs/framework-tools/generateTypes'

await build({
  entryPointOptions: {
    ignore: [...defaultIgnorePatterns, '**/bundled'],
  },
  buildOptions: {
    ...defaultBuildOptions,
    tsconfig: 'tsconfig.build.json',
    format: 'esm',
    packages: 'external',
  },
})

// We bundle some react packages with the "react-server" condition
// so that we don't need to specify it at runtime.
await esbuild.build({
  entryPoints: ['src/bundled/*'],
  outdir: 'dist/bundled',
  format: 'esm',
  bundle: true,
  conditions: ['react-server'],
  platform: 'node',
  target: ['node24'],
  // Without this plugin, we get "Error: Dynamic require of "util" is not
  // supported" when trying to run the built files. This plugin will "just
  // rewrite that file to replace "require(node-module)" to a toplevel static
  // import statement." (see issue)
  // https://github.com/evanw/esbuild/issues/2113
  // https://github.com/evanw/esbuild/pull/2067
  plugins: [commonjs()],
  logLevel: 'info',
  tsconfig: 'tsconfig.build.json',
})

await generateTypesEsm()
