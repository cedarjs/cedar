import { createRequire } from 'node:module'

import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

let bufferPath: string

function getBufferPath(): string {
  if (!bufferPath) {
    // `__filename` exists in CJS (e.g. when loaded by Vite's config require-hook)
    // but not in ESM, where we use import.meta.url instead.
    const url = typeof __filename !== 'undefined' ? __filename : import.meta.url
    bufferPath = createRequire(url).resolve('buffer/')
  }
  return bufferPath
}

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
            buffer: getBufferPath(),
          },
        },
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
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
    },
  }
}
