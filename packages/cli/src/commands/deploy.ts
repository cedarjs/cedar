import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import * as deployBaremetal from './deploy/baremetal.js'
import * as deployFlightcontrol from './deploy/flightcontrol.js'
// @ts-expect-error - Types not available for JS files
import * as deployNetlify from './deploy/netlify.js'
// @ts-expect-error - Types not available for JS files
import * as deployRender from './deploy/render.js'
// @ts-expect-error - Types not available for JS files
import * as deployServerless from './deploy/serverless.js'
// @ts-expect-error - Types not available for JS files
import * as deployVercel from './deploy/vercel.js'

export const command = 'deploy <target>'
export const description = 'Deploy your Redwood project'
export const builder = (yargs: Argv) =>
  yargs
    .command(deployBaremetal)
    // @ts-expect-error - Yargs TS types aren't very good
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
