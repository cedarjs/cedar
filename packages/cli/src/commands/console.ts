export const command = 'console'
export const aliases = ['c']
export const description = 'Launch an interactive Redwood shell (experimental)'

export const handler = async () => {
  const { handler } = await import('./consoleHandler.js')
  return handler()
}
