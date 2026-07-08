import ansis from 'ansis'

import type { Config } from './config.ts'
import { getCcrscaVersion } from './version.ts'

export function printWelcome() {
  console.log()
  console.log(
    ansis
      .hex('#bf4722')
      .bold(
        '🌲 Welcome to the Cedar RSC quick-start installer ' +
          `v${getCcrscaVersion()} 🌲`,
      ),
  )
  console.log()
  console.log(
    'This installer is designed to get you started as fast as possible.',
  )
  console.log(
    'If you need a more customized setup, please use the official installer ' +
      'by running `yarn create cedar-app`',
  )
  console.log()
}

export function printDone(config: Config) {
  console.log()
  console.log('🎉 Done!')
  console.log()
  console.log(
    'You can now run the following commands to build and serve the included ' +
      'example application',
  )
  console.log()
  console.log(ansis.hex('#cef792')('> cd ' + config.installationDir))
  console.log(ansis.hex('#cef792')('> yarn cedar build -v && yarn cedar serve'))
}
