import { createRequire } from 'node:module'
import path from 'node:path'

import type { Plugin } from 'vite'
// Load Vitest's module augmentation of Vite's `UserConfig` and `Plugin` so
// that the `test` property returned from the `config` hook and the
// `configureVitest` hook below typecheck
import type {} from 'vitest/config'

import { getPaths } from '@cedarjs/project-config'

import { dependsOn, readPackageJson } from '../../packageJson.js'

/**
 * Imported by the setup file for `clearOrgClients`. Resolves to the app's own
 * `@cedarjs/tenancy/web`, or to a module without it in an app without
 * tenancy.
 */
export const TENANCY_WEB_MODULE_ID = 'virtual:cedar-testing-tenancy-web'
const NO_TENANCY_WEB_MODULE_ID = '\0' + TENANCY_WEB_MODULE_ID

/** The setup file this plugin adds to every web test file */
export const SETUP_FILE = path.join(import.meta.dirname, 'vitest-web.setup.js')

function webPackageJsonPath() {
  return path.join(getPaths().web.base, 'package.json')
}

/**
 * Whether the web side's `package.json` lists `@cedarjs/tenancy`. A copy
 * that is only reachable from an ancestor `node_modules` (another app in the
 * same monorepo, say) doesn't count.
 */
function webSideHasTenancy() {
  const webPackageJson = readPackageJson(webPackageJsonPath())

  return !!webPackageJson && dependsOn(webPackageJson, '@cedarjs/tenancy')
}

/**
 * The part of the cache key of the module `id` that Cedar adds, for the setup
 * file only. Vitest caches the transformed setup file, with the module the
 * virtual tenancy module resolved to, keyed on the setup file's own source.
 * So adding or removing tenancy, or installing it somewhere else, changes the
 * key.
 */
export function setupFileCacheKey(id: string) {
  if (path.normalize(id) !== path.normalize(SETUP_FILE)) {
    return undefined
  }

  if (!webSideHasTenancy()) {
    return 'cedar-testing-no-tenancy'
  }

  try {
    return (
      'cedar-testing-tenancy:' +
      createRequire(webPackageJsonPath()).resolve('@cedarjs/tenancy/web')
    )
  } catch {
    return 'cedar-testing-unresolved-tenancy'
  }
}

/**
 * Contributes web-side Vitest config, most importantly a setup file that
 * starts MSW so that `mockGraphQLQuery`/`mockGraphQLMutation` handlers (and
 * cell mocks) actually intercept GraphQL requests during tests.
 *
 * Vitest resolves its `test` config from Vite plugins, so returning `test`
 * from the `config` hook here merges with the user's own vitest config (the
 * `setupFiles` arrays are concatenated).
 *
 * The setup file gets the app's tenancy through the virtual module
 * `virtual:cedar-testing-tenancy-web`. An app has tenancy when the web
 * side's `package.json` lists `@cedarjs/tenancy`. In an app with tenancy,
 * the module is `@cedarjs/tenancy/web` resolved by Vite from the web side,
 * exactly as the app's own imports of it are, so the setup file and the app
 * share one instance of it and its per-organization clients. An app that
 * lists `@cedarjs/tenancy` but can't resolve it fails its tests rather than
 * run them without clearing those clients.
 */
export function cedarVitestWebConfigPlugin(): Plugin {
  return {
    name: 'cedar-vitest-web-config',
    config: () => {
      return {
        test: {
          setupFiles: [SETUP_FILE],
        },
      }
    },

    configureVitest({ defineCacheKeyGenerator }) {
      defineCacheKeyGenerator(({ id }) => setupFileCacheKey(id))
    },

    async resolveId(id) {
      if (id !== TENANCY_WEB_MODULE_ID) {
        return null
      }

      if (!webSideHasTenancy()) {
        return NO_TENANCY_WEB_MODULE_ID
      }

      const resolved = await this.resolve(
        '@cedarjs/tenancy/web',
        webPackageJsonPath(),
        { skipSelf: true },
      )

      if (!resolved) {
        throw new Error(
          `${webPackageJsonPath()} lists @cedarjs/tenancy, but ` +
            "@cedarjs/tenancy/web can't be resolved from the web side. " +
            'Run `yarn install` to install it, or remove @cedarjs/tenancy ' +
            "from the web side's dependencies if the app has no tenancy.",
        )
      }

      return resolved
    },

    load(id) {
      if (id !== NO_TENANCY_WEB_MODULE_ID) {
        return null
      }

      return 'export const clearOrgClients = undefined'
    },
  }
}
