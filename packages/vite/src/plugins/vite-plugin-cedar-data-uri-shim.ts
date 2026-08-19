import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

function dataUriToBuffer(uri: string) {
  const match = uri.match(/^data:(.*?)(;(.*?))?(,(.*))$/)
  if (!match) {
    throw new Error('Invalid data URI')
  }

  const mediaType = match[1] || 'text/plain'
  const params = match[3] || ''
  const data = match[5]

  const [type] = mediaType.split(';')
  const typeFull = params ? mediaType + ';' + params : mediaType

  const lowerParams = params.toLowerCase()
  const isBase64 = lowerParams.includes('base64')

  const charset = lowerParams.startsWith('charset=') ? lowerParams.slice(8) : ''

  const bytes = isBase64
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data))

  const decoder = new TextDecoder()
  bytes.toString = () => decoder.decode(bytes)

  return Object.assign(bytes, { type, typeFull, charset })
}

export function cedarDataUriShim(): Plugin | undefined {
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
    name: 'cedar-data-uri-shim',
    apply: 'serve',
    resolveId(id) {
      if (id === 'data-uri-to-buffer') {
        return '\0cedar-data-uri-to-buffer'
      }
      return undefined
    },
    load(id) {
      if (id === '\0cedar-data-uri-to-buffer') {
        return 'export default ' + dataUriToBuffer.toString()
      }
      return undefined
    },
  }
}
