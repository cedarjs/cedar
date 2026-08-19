export const command = 'console'
export const aliases = ['c']
export const description = 'Launch an interactive Cedar shell'

export const handler = async () => {
  console.log(
    '`cedar console` has been removed from the Cedar CLI.\n' +
      'Run it as a standalone tool instead:\n\n' +
      '  yarn dlx @cedarjs/console\n' +
      '  npx @cedarjs/console\n' +
      '  pnpm dlx @cedarjs/console\n',
  )
  process.exit(1)
}
