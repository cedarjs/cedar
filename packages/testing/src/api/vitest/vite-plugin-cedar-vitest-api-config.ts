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
          // `@cedarjs/tenancy` reads and writes the request context, which
          // the api test setup replaces with a mock. The mock only reaches
          // code Vite processes, so the tenancy runtime has to be bundled
          // rather than loaded as an external dependency, or a service under
          // test and its Prisma extension would see different contexts.
          noExternal: ['@cedarjs/testing', '@cedarjs/tenancy'],
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
