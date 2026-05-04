import { addEntry, catchAllEntry } from '@universal-deploy/store'
import type { Plugin } from 'vite'

export interface CedarUniversalDeployPluginOptions {
  apiRootPath?: string
}

const VIRTUAL_CEDAR_API = 'virtual:cedar-api'
const RESOLVED_VIRTUAL_CEDAR_API = '\0virtual:cedar-api'

export function cedarUniversalDeployPlugin(
  options: CedarUniversalDeployPluginOptions = {},
): Plugin {
  const { apiRootPath } = options

  return {
    name: 'cedar-universal-deploy',
    apply: 'build',

    buildStart() {
      addEntry({
        id: VIRTUAL_CEDAR_API,
        route: '/**',
      })
    },

    resolveId(id) {
      if (id === catchAllEntry) {
        return RESOLVED_VIRTUAL_CEDAR_API
      }

      if (id === VIRTUAL_CEDAR_API) {
        return RESOLVED_VIRTUAL_CEDAR_API
      }

      return undefined
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_CEDAR_API) {
        return undefined
      }

      const apiRootPathArg =
        apiRootPath !== undefined
          ? `{ apiRootPath: ${JSON.stringify(apiRootPath)} }`
          : 'undefined'

      return `
import { buildCedarDispatcher } from '@cedarjs/api-server/udDispatcher';
const { fetchable } = await buildCedarDispatcher(${apiRootPathArg});
export default fetchable;
`
    },
  }
}
