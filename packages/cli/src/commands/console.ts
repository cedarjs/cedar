export const command = 'console'
export const aliases = ['c']
export const description = 'Launch an interactive Redwood shell (experimental)'

export const handler = async (_options: Record<string, unknown>) => {
  const { handler } = await import('./consoleHandler.js')
  return handler()
}
