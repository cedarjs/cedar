import type { Plugin } from 'vite'

export function mockProvidersRelativeRoutesPathsPlugin(): Plugin {
  return {
    name: 'cedarjs:mock-providers-relative-routes-paths',
    resolveId(id, importer) {
      // This is needed to resolve relative paths in the Routes.tsx file when
      // it's imported by the virtual 'cedarjs:/Routes.tsx' module in
      // @cedarjs/testing's MockProviders.js
      if (importer === 'cedarjs:/Routes.tsx' && id.startsWith('./')) {
        return id
      }

      return null
    },
  }
}
