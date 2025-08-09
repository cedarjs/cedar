// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Silence the TS error on this line for CJS builds
import type { PluginOption } from 'vite'

export function createAuthImportTransformPlugin(): PluginOption {
  return {
    name: 'create-auth-import-transform',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (id.endsWith('/web/src/auth.ts') || id.endsWith('/web/src/auth.js')) {
        // Remove any existing import of `createAuth` without affecting anything
        // else.
        // This regex defines 4 capture groups, where the second is `createAuth`
        // and the third is an (optional) comma for subsequent named imports —
        // we want to remove those two.
        code = code.replace(
          /(^\s*import\s*{[^}]*?)(\bcreateAuth\b)(,?)([^}]*})/m,
          '$1$4',
        )
        // Add import to mocked `createAuth` at the top of the file.
        code =
          "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'\n" +
          code
      }
      return code
    },
  }
}
