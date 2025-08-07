// See these threads:
// - https://github.com/facebook/jest/issues/12770
// - https://github.com/microsoft/accessibility-insights-web/pull/5421#issuecomment-1109168149.
//
// TL;DR, we need to resolve uuid to a CommonJS version. So we leverage jest's default resolver,
// but use `packageFilter` to process parsed `package.json` before resolution. In doing so,
// we only override how jest resolves uuid.

import type { ResolverOptions } from 'jest-resolve'

function resolver(path: string, options: ResolverOptions) {
  return options.defaultResolver(path, {
    ...options,
    packageFilter: (pkg: any) => {
      if (OVERRIDE_EXPORTS_LIST.has(pkg.name)) {
        delete pkg['exports']
        delete pkg['module']
      }

      return pkg
    },
  })
}

// Export using CommonJS compatible `export =` syntax for Jest compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - `export =` is required for Jest compatibility despite ES
// module target
export = resolver

const OVERRIDE_EXPORTS_LIST = new Set([
  '@firebase/analytics',
  '@firebase/app',
  '@firebase/app-check',
  '@firebase/auth',
  '@firebase/database',
  '@firebase/firestore',
  '@firebase/functions',
  '@firebase/installations',
  '@firebase/messaging',
  '@firebase/performance',
  '@firebase/remote-config',
  '@firebase/storage',
  '@firebase/util',
  'firebase',
])
