import { createRequire } from 'node:module'

import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

const require = createRequire(import.meta.url)
const bufferPath = require.resolve('buffer/')

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

  return {
    name: 'cedar-buffer-polyfill',
    apply: 'serve',
    config() {
      return {
        resolve: {
          alias: {
            buffer: bufferPath,
          },
        },
      }
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: [
            "import { Buffer as __buffer_polyfill } from 'buffer'",
            'globalThis.Buffer = globalThis.Buffer || __buffer_polyfill',
          ].join('\n'),
        },
      ]
    },
  }
}
