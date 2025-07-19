import fs from 'node:fs'

import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export function mockProvidersRoutesPlugin(): Plugin {
  const routesPath = getPaths().web.routes
  const routes = fs.readFileSync(routesPath, 'utf-8')

  return {
    name: 'cedarjs:mock-providers-routes',
    resolveId(id) {
      if (id === 'cedarjs:/Routes.tsx') {
        return id
      }

      return null
    },
    load(id, options) {
      if (id === 'cedarjs:/Routes.tsx') {
        console.log('cedarjs:/Routes.tsx Loading ID:', id, 'options:', options)
        return routes
      }

      return null
    },
  }
}
