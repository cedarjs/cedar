import type { Argv } from 'yargs'

import { MONITORS } from '../../../deploy/baremetal/monitors.js'
import { createHandler } from '../helpers/helpers.js'

export const command = 'baremetal'
export const description = 'Setup Baremetal deploy'

export const builder = (yargs: Argv) =>
  yargs.option('monitor', {
    description:
      'Process monitor to generate config for. Asks when not given. pm2 gets ' +
      'an ecosystem.config.js, systemd gets unit files in systemd/',
    choices: MONITORS,
    type: 'string',
  })

export const handler = createHandler('baremetal')
