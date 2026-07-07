const dataUriRegex = /^data:(.*?)(;(.*?))?(,(.*))$/

export function dataUriToBuffer(uri: string) {
  const match = uri.match(dataUriRegex)
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
