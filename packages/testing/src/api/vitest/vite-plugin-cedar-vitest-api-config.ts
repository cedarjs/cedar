import path from 'node:path'

import type { Plugin } from 'vite'

import { getEnvVarDefinitions, getPaths } from '@cedarjs/project-config'

export function cedarVitestApiConfigPlugin(): Plugin {
  return {
    name: 'cedar-vitest-plugin',
    config: () => {
      return {
        define: getEnvVarDefinitions(),
        ssr: {
          noExternal: ['@cedarjs/testing'],
        },
        resolve: {
          alias: {
            src: getPaths().api.src,
          },
        },
        test: {
          environment: path.join(import.meta.dirname, 'CedarApiVitestEnv.js'),
          // All api test files share a single test database, so they can't
          // run in parallel. In Vitest 3 project-level fileParallelism didn't
          // work (https://github.com/vitest-dev/vitest/discussions/7416) and
          // we used the now-removed `poolOptions: { forks: { singleFork:
          // true } }` as a workaround. Vitest 4 removed `poolOptions` and
          // supports `fileParallelism` in project configs.
          fileParallelism: false,
          setupFiles: [path.join(import.meta.dirname, 'vitest-api.setup.js')],
        },
      }
    },
  }
}
