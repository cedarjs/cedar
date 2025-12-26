import ansis from 'ansis'

/**
 * To keep a consistent color/style palette between cli packages, such as
 * @redwood/cli and @redwood/create-cedar-app, please keep them compatible
 * with one and another. We'll might split up and refactor these into a
 * separate package when there is a strong motivation behind it.
 *
 * Current files:
 *
 * - packages/cli/src/lib/colors.js (this file)
 * - packages/create-cedar-app/src/create-cedar-app.js
 */
export default {
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
