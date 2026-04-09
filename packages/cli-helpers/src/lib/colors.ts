import ansis from 'ansis'

/**
 * Canonical color/style palette for all Cedar CLI packages.
 *
 * Import from here rather than defining local copies:
 *   import { colors } from '@cedarjs/cli-helpers'
 *
 * If you need a color that isn't here, add it here rather than
 * introducing a one-off in another package.
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
