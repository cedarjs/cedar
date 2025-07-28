import { terminalLink } from 'termi-link'

import detectRxVersion from '../middleware/detectProjectRxVersion.js'

import * as experimentalInngest from './experimental/setupInngest.js'
import * as experimentalOpenTelemetry from './experimental/setupOpentelemetry.js'
import * as experimentalReactCompiler from './experimental/setupReactCompiler.js'
import * as experimentalRsc from './experimental/setupRsc.js'
import * as experimentalStreamingSsr from './experimental/setupStreamingSsr.js'

export const command = 'experimental <command>'
export const aliases = ['exp']
export const description = 'Run or setup experimental features'

export const builder = (yargs) =>
  yargs
    .command(experimentalInngest)
    .command(experimentalOpenTelemetry)
    .command(experimentalReactCompiler)
    .command(experimentalRsc)
    .command(experimentalStreamingSsr)
    .demandCommand()
    .middleware(detectRxVersion)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#experimental',
      )}`,
    )
