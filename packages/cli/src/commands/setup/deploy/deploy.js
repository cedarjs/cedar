export const command = 'deploy <target>'
export const description = 'Setup deployment to various targets'
import { terminalLink } from 'termi-link'

import * as setupDeployBaremetal from './providers/baremetal.js'
import * as setupDeployCoherence from './providers/coherence.js'
import * as setupDeployFlightcontrol from './providers/flightcontrol.js'
import * as setupDeployNetlify from './providers/netlify.js'
import * as setupDeployRender from './providers/render.js'
import * as setupDeployServerless from './providers/serverless.js'
import * as setupDeployVercel from './providers/vercel.js'

export const builder = (yargs) =>
  yargs
    .command(setupDeployBaremetal)
    .command(setupDeployCoherence)
    .command(setupDeployFlightcontrol)
    .command(setupDeployNetlify)
    .command(setupDeployRender)
    .command(setupDeployServerless)
    .command(setupDeployVercel)
    .demandCommand()
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-deploy-config',
      )}`,
    )
