import path from 'path'
import { fileURLToPath } from 'url'

import { defineConfig, configDefaults } from 'vitest/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/fixtures', '**/__typetests__'],
    deps: {
      interopDefault: false,
    },
    globalSetup: ['vitest.setup.mts'],
    alias: {
      // We alias prisma client, otherwise you'll get "prisma client not initialized"
      // Important to have the subpaths first here - they must come before the
      // main '@prisma/client' alias, otherwise the prefix match intercepts them.
      '@prisma/client/extension': path.resolve(
        __dirname,
        '../../node_modules/@prisma/client/extension.js',
      ),
      // The new prisma-client provider generates TypeScript files that import
      // from @prisma/client/runtime/* at runtime - these must resolve to the
      // actual npm package, not the local generated client.
      '@prisma/client/runtime/client': path.resolve(
        __dirname,
        '../../node_modules/@prisma/client/runtime/client.js',
      ),
      '@prisma/client/runtime/query_compiler_fast_bg.sqlite.mjs': path.resolve(
        __dirname,
        '../../node_modules/@prisma/client/runtime/query_compiler_fast_bg.sqlite.mjs',
      ),
      '@prisma/client/runtime/query_compiler_fast_bg.sqlite.wasm-base64.mjs':
        path.resolve(
          __dirname,
          '../../node_modules/@prisma/client/runtime/query_compiler_fast_bg.sqlite.wasm-base64.mjs',
        ),
      '@prisma/client/runtime/index-browser': path.resolve(
        __dirname,
        '../../node_modules/@prisma/client/runtime/index-browser.js',
      ),
      '@prisma/client': path.resolve(
        __dirname,
        'src/__tests__/prisma-client/client.ts',
      ),
    },
  },
})
