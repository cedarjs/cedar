// TODO: This file should be deduplicated across the framework
// when we take the time to make architectural changes.

import ansis from 'ansis'

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
  link: ansis.hex('#e8e8e8'),
}
