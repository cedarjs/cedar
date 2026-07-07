import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

export function cedarNodePolyfills(): Plugin | undefined {
  // `stacktracey` pulls in `get-source`, which uses an old version of
  // `data-uri-to-buffer` that returns a `Buffer`. Since `data-uri-to-buffer`
  // is only used for inline source map parsing in the dev error page, we
  // replace it with a tiny shim that returns a `Uint8Array` instead.
  //
  // This avoids needing a full Buffer polyfill.

  if (getConfig().experimental?.rsc?.enabled) {
    return undefined
  }

  return {
    name: 'cedar-node-polyfills',
    apply: 'serve',
    config() {
      const filePath =
        typeof __filename !== 'undefined'
          ? __filename
          : fileURLToPath(import.meta.url)
      const shimPath = path.resolve(
        filePath,
        '../../shim/data-uri-to-buffer.js',
      )

      return {
        resolve: {
          alias: {
            'data-uri-to-buffer': shimPath,
          },
        },
      }
    },
  }
}
