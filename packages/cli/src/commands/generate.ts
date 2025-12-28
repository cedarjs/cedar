import execa from 'execa'
import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - No types for .js files
import * as generateCell from './generate/cell/cell.js'
// @ts-expect-error - No types for .js files
import * as generateComponent from './generate/component/component.js'
// @ts-expect-error - No types for .js files
import * as generateDataMigration from './generate/dataMigration/dataMigration.js'
// @ts-expect-error - No types for .js files
import * as generateDbAuth from './generate/dbAuth/dbAuth.js'
// @ts-expect-error - No types for .js files
import * as generateDirective from './generate/directive/directive.js'
// @ts-expect-error - No types for .js files
import * as generateFunction from './generate/function/function.js'
// @ts-expect-error - No types for .js files
import * as generateJob from './generate/job/job.js'
// @ts-expect-error - No types for .js files
import * as generateLayout from './generate/layout/layout.js'
// @ts-expect-error - No types for .js files
import * as generateModel from './generate/model/model.js'
// @ts-expect-error - No types for .js files
import * as generateOgImage from './generate/ogImage/ogImage.js'
// @ts-expect-error - No types for .js files
import * as generatePage from './generate/page/page.js'
// @ts-expect-error - No types for .js files
import * as generateRealtime from './generate/realtime/realtime.js'
// @ts-expect-error - No types for .js files
import * as generateScaffold from './generate/scaffold/scaffold.js'
// @ts-expect-error - No types for .js files
import * as generateScript from './generate/script/script.js'
// @ts-expect-error - No types for .js files
import * as generateSdl from './generate/sdl/sdl.js'
// @ts-expect-error - No types for .js files
import * as generateSecret from './generate/secret/secret.js'
// @ts-expect-error - No types for .js files
import * as generateService from './generate/service/service.js'

export const command = 'generate <type>'
export const aliases = ['g']
export const description = 'Generate boilerplate code and type definitions'

export const builder = (yargs: Argv) =>
  yargs
    .command('types', 'Generate supplementary code', {}, () => {
      recordTelemetryAttributes({ command: 'generate types' })

      try {
        execa.sync('yarn', ['rw-gen'], { stdio: 'inherit' })
      } catch (error: unknown) {
        // rw-gen is responsible for logging its own errors but we need to
        // make sure we exit with a non-zero exit code
        if (
          error instanceof Object &&
          'exitCode' in error &&
          typeof error.exitCode === 'number'
        ) {
          process.exitCode = error.exitCode
        } else {
          process.exitCode = 1
        }
      }
    })
    .command(generateCell)
    .command(generateComponent)
    .command(generateDataMigration)
    .command(generateDbAuth)
    .command(generateDirective)
    .command(generateFunction)
    .command(generateJob)
    .command(generateLayout)
    .command(generateModel)
    .command(generateOgImage)
    .command(generatePage)
    .command(generateRealtime)
    .command(generateScaffold)
    .command(generateScript)
    .command(generateSdl)
    .command(generateSecret)
    .command(generateService)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#generate-alias-g',
      )}`,
    )
