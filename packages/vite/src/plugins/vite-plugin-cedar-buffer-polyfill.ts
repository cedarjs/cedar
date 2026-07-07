import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

export function cedarBufferPolyfill(): Plugin | undefined {
  // Only include the Buffer polyfill for non-rsc dev, for DevFatalErrorPage
  // Including the polyfill plugin in any form in RSC breaks
  //
  // The buffer polyfill is used by stacktracey. And only because it uses
  // `get-source`, which pulls in a super old version of `data-uri-to-buffer`
  // (and `source-map`). Newer versions of `data-uri-to-buffer` no longer needs
  // the polyfill.

  if (getConfig().experimental?.rsc?.enabled) {
    return undefined
  }

  const bufferBanner = [
    "import { Buffer as __buffer_polyfill } from 'buffer'",
    'globalThis.Buffer = globalThis.Buffer || __buffer_polyfill',
  ].join('\n')

  return {
    name: 'cedar-buffer-polyfill',
    apply: 'serve',
    config() {
      return {
        esbuild: {
          banner: bufferBanner,
        },
        optimizeDeps: {
          esbuildOptions: {
            define: {
              Buffer: 'Buffer',
            },
            banner: {
              js: bufferBanner,
            },
          },
        },
      }
    },
  }
}
