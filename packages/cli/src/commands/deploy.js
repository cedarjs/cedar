import { terminalLink } from 'termi-link'

import * as deployBaremetal from './deploy/baremetal.js'
import * as deployFlightcontrol from './deploy/flightcontrol.js'
import * as deployNetlify from './deploy/netlify.js'
import * as deployRender from './deploy/render.js'
import * as deployServerless from './deploy/serverless.js'
import * as deployVercel from './deploy/vercel.js'

export const command = 'deploy <target>'
export const description = 'Deploy your Redwood project'
export const builder = (yargs) =>
  yargs
    .command(deployBaremetal)
    .command(deployFlightcontrol)
    .command(deployNetlify)
    .command(deployRender)
    .command(deployServerless)
    .command(deployVercel)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#deploy',
      )}\n`,
    )
