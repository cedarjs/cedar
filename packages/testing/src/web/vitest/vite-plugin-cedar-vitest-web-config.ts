import path from 'node:path'

import type { Plugin } from 'vite'
// Load Vitest's module augmentation of Vite's `UserConfig` so that the `test`
// property returned from the `config` hook below typechecks
import type {} from 'vitest/config'

/**
 * Contributes web-side Vitest config, most importantly a setup file that
 * starts MSW so that `mockGraphQLQuery`/`mockGraphQLMutation` handlers (and
 * cell mocks) actually intercept GraphQL requests during tests.
 *
 * Vitest resolves its `test` config from Vite plugins, so returning `test`
 * from the `config` hook here merges with the user's own vitest config (the
 * `setupFiles` arrays are concatenated).
 */
export function cedarVitestWebConfigPlugin(): Plugin {
  return {
    name: 'cedar-vitest-web-config',
    config: () => {
      return {
        test: {
          setupFiles: [path.join(import.meta.dirname, 'vitest-web.setup.js')],
        },
      }
    },
  }
}
