import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { detectCedarVersion } from '../middleware/detectProjectCedarVersion.js'

// @ts-expect-error - Types not available for JS files
import * as experimentalInngest from './experimental/setupInngest.js'
// @ts-expect-error - Types not available for JS files
import * as experimentalOpenTelemetry from './experimental/setupOpentelemetry.js'
// @ts-expect-error - Types not available for JS files
import * as experimentalReactCompiler from './experimental/setupReactCompiler.js'
// @ts-expect-error - Types not available for JS files
import * as experimentalRsc from './experimental/setupRsc.js'
// @ts-expect-error - Types not available for JS files
import * as experimentalStreamingSsr from './experimental/setupStreamingSsr.js'

export const command = 'experimental <command>'
export const aliases = ['exp']
export const description = 'Run or setup experimental features'

export const builder = (yargs: Argv) =>
  yargs
    .command(experimentalInngest)
    .command(experimentalOpenTelemetry)
    .command(experimentalReactCompiler)
    .command(experimentalRsc)
    .command(experimentalStreamingSsr)
    .demandCommand()
    // @ts-expect-error - Yargs TS types aren't very good
    .middleware(detectCedarVersion)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#experimental',
      )}`,
    )
