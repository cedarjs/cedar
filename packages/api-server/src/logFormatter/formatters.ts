// See https://github.com/webdiscus/ansis#troubleshooting
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ansis from 'ansis'
import prettyBytes from 'pretty-bytes'
import prettyMs from 'pretty-ms'

export const NEWLINE = '\n'

export const emojiLog: Record<string, string> = {
  warn: '🚦',
  info: '🌲',
  error: '🚨',
  debug: '🐛',
  fatal: '💀',
  trace: '🧵',
}

export const ignoredCustomData: string[] = [
  'time',
  'pid',
  'hostname',
  'msg',
  'res',
  'req',
  'reqId',
  'responseTime',
]

export const isObject = (object?: Record<string, unknown>) => {
  return object && Object.prototype.toString.apply(object) === '[object Object]'
}

export const isEmptyObject = (object?: Record<string, unknown>) => {
  return object && !Object.keys(object).length
}

export const isPinoLog = (log?: Record<string, unknown>) => {
  return log && Object.prototype.hasOwnProperty.call(log, 'level')
}

export const isWideEmoji = (character: string) => {
  return character !== '🚦'
}

export const formatBundleSize = (bundle: string) => {
  const bytes = parseInt(bundle, 10)
  const size = prettyBytes(bytes).replace(/ /, '')
  return ansis.gray(size)
}

export const formatCustom = (query?: Record<string, unknown>) => {
  if (!query) {
    return
  }

  ignoredCustomData.forEach((key) => {
    delete query[key]
  })

  if (!isEmptyObject(query)) {
    return ansis.white(
      NEWLINE + '🗒 Custom' + NEWLINE + JSON.stringify(query, null, 2),
    )
  }

  return
}

export const formatData = (data?: Record<string, unknown>) => {
  if (!isEmptyObject(data)) {
    return ansis.white(
      NEWLINE + '📦 Result Data' + NEWLINE + JSON.stringify(data, null, 2),
    )
  }

  return
}

export const formatDate = (instant: Date) => {
  const date = new Date(instant)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  const prettyDate = hours + ':' + minutes + ':' + seconds
  return ansis.gray(prettyDate)
}

export const formatErrorProp = (errorPropValue: Record<string, unknown>) => {
  const errorType = errorPropValue['type'] || 'Error'

  delete errorPropValue['message']
  delete errorPropValue['stack']
  delete errorPropValue['type']

  return ansis.redBright(
    NEWLINE +
      NEWLINE +
      `🚨 ${errorType} Info` +
      NEWLINE +
      NEWLINE +
      JSON.stringify(errorPropValue, null, 2) +
      NEWLINE,
  )
}

export const formatLevel = (level: any) => {
  const emoji = emojiLog[level]
  const padding = isWideEmoji(emoji) ? '' : ' '
  return emoji + padding
}

export const formatLoadTime = (elapsedTime: any) => {
  const elapsed = parseInt(elapsedTime, 10)
  const time = prettyMs(elapsed)
  return ansis.gray(time)
}

export const formatMessage = (logData: any) => {
  const { level, message } = logData

  const msg = formatMessageName(message)
  let pretty
  if (level === 'error') {
    pretty = ansis.red(msg)
  }
  if (level === 'trace') {
    pretty = ansis.white(msg)
  }
  if (level === 'warn') {
    const orange = '#ffa500'
    pretty = ansis.hex(orange)(msg)
  }
  if (level === 'debug') {
    pretty = ansis.yellow(msg)
  }
  if (level === 'info' || level === 'customlevel') {
    pretty = ansis.green(msg)
  }
  if (level === 'fatal') {
    pretty = ansis.white.bgRed(msg)
  }
  return pretty
}

export const formatMethod = (method: string) => {
  return method && ansis.white(method)
}

export const formatRequestId = (requestId: string) => {
  return requestId && ansis.cyan(requestId)
}

export const formatNs = (ns: string) => {
  return ns && ansis.cyan(ns)
}

export const formatName = (name: string) => {
  return name && ansis.blue(name)
}

export const formatMessageName = (message: string) => {
  if (message === undefined) {
    return ''
  }

  if (message === 'request') {
    return '<--'
  }
  if (message === 'response') {
    return '-->'
  }
  return message
}

export const formatOperationName = (operationName: string) => {
  return ansis.white(NEWLINE + '🏷  ' + operationName)
}

export const formatQuery = (query?: Record<string, unknown>) => {
  if (!isEmptyObject(query)) {
    return ansis.white(
      NEWLINE + '🔭 Query' + NEWLINE + JSON.stringify(query, null, 2),
    )
  }

  return
}

export const formatResponseCache = (
  responseCache?: Record<string, unknown>,
) => {
  if (!isEmptyObject(responseCache)) {
    return ansis.white(
      NEWLINE +
        '💾 Response Cache' +
        NEWLINE +
        JSON.stringify(responseCache, null, 2),
    )
  }

  return
}

export const formatStatusCode = (statusCode: string) => {
  statusCode = statusCode || 'xxx'
  return ansis.white(statusCode)
}

export const formatStack = (stack?: string | Record<string, unknown>) => {
  return ansis.redBright(
    stack
      ? NEWLINE + '🥞 Error Stack' + NEWLINE + NEWLINE + stack + NEWLINE
      : '',
  )
}

export const formatTracing = (data?: Record<string, unknown>) => {
  if (!isEmptyObject(data)) {
    return ansis.white(
      NEWLINE + '⏰ Timing' + NEWLINE + JSON.stringify(data, null, 2),
    )
  }

  return
}

export const formatUrl = (url: string) => {
  return ansis.white(url)
}

export const formatUserAgent = (userAgent: string) => {
  return ansis.gray(NEWLINE + '🕵️‍♀️ ' + userAgent)
}

export const noEmpty = (value: any) => {
  return !!value
}
