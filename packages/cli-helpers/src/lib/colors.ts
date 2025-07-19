import ansis from 'ansis'

/**
 * To keep a consistent color/style palette between cli packages, such as
 * @redwood/cli and @redwood/create-cedar-app, please only use the colors
 * defined here. If you *really* can't find a color that fits your needs,
 * it's better to add it here than to introduce a new one-off color in whatever
 * package you're going to use it in.
 */
export const colors = {
  error: ansis.bold.red,
  warning: ansis.hex('#ffa500'),
  highlight: ansis.hex('#ffa500'),
  success: ansis.green,
  info: ansis.gray,
  bold: ansis.bold,
  underline: ansis.underline,
  note: ansis.blue,
  tip: ansis.green,
  important: ansis.magenta,
  caution: ansis.red,
  link: ansis.underline,
}
