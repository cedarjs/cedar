export const command = 'console'
export const aliases = ['c']
export const description = 'Launch an interactive Redwood shell (experimental)'

export const handler = async (options: Record<string, unknown>) => {
  const { handler } = await import('./consoleHandler.js')
  return handler(options)
}
