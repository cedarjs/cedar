export const command = 'console'
export const aliases = ['c']
export const description = 'Launch an interactive Redwood shell (experimental)'

export const handler = async (options: Record<string, unknown>) => {
  // @ts-expect-error - Types not available for JS files
  const { handler } = await import('./consoleHandler.js')
  return handler(options)
}
