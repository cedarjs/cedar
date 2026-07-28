import type { Plugin } from 'vite'

/**
 * `$api/` imports resolve to files on the api side. They're only supported in
 * `*.routeHooks.{js,ts}` files and in scripts run with `yarn cedar exec` – both
 * of which run on the server. This plugin makes a `$api/` import from code that
 * ends up in the browser bundle fail with an explanatory error instead of
 * silently bundling server-only code (like the Prisma client) into the browser.
 *
 * Has to run before `vite-tsconfig-paths`, which would otherwise resolve
 * `$api/*` using the `paths` mapping in the project's `web/tsconfig.json`.
 */
export function cedarApiImportGuardPlugin(): Plugin {
  return {
    name: 'cedar-api-import-guard',
    enforce: 'pre',

    resolveId(id: string, importer?: string) {
      // `this.environment` is undefined when the plugin is used outside of a
      // Vite environment. Bailing there keeps the guard from firing in
      // contexts where we can't tell client code from server code
      if (this.environment?.name !== 'client' || !id.startsWith('$api/')) {
        return null
      }

      throw new Error(
        `Cannot import "${id}" from client-side code` +
          (importer ? ` (imported by "${importer}")` : '') +
          '.\n\n' +
          '"$api/" imports resolve to your api side, which must never end up ' +
          "in the browser bundle. They're only supported in server-side " +
          'code, like *.routeHooks.{js,ts} files and scripts run with ' +
          '`yarn cedar exec`.\n\n' +
          'If you need this data in the browser, fetch it through GraphQL ' +
          'instead.',
      )
    },
  }
}
