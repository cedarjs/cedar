import execa from 'execa'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import * as generateCell from './generate/cell/cell.js'
import * as generateComponent from './generate/component/component.js'
import * as generateDataMigration from './generate/dataMigration/dataMigration.js'
import * as generateDbAuth from './generate/dbAuth/dbAuth.js'
import * as generateDirective from './generate/directive/directive.js'
import * as generateFunction from './generate/function/function.js'
import * as generateJob from './generate/job/job.js'
import * as generateLayout from './generate/layout/layout.js'
import * as generateModel from './generate/model/model.js'
import * as generateOgImage from './generate/ogImage/ogImage.js'
import * as generatePage from './generate/page/page.js'
import * as generateRealtime from './generate/realtime/realtime.js'
import * as generateScaffold from './generate/scaffold/scaffold.js'
import * as generateScript from './generate/script/script.js'
import * as generateSdl from './generate/sdl/sdl.js'
import * as generateSecret from './generate/secret/secret.js'
import * as generateService from './generate/service/service.js'

export const command = 'generate <type>'
export const aliases = ['g']
export const description = 'Generate boilerplate code and type definitions'

export const builder = (yargs) =>
  yargs
    .command('types', 'Generate supplementary code', {}, () => {
      recordTelemetryAttributes({
        command: 'generate types',
      })
      try {
        execa.sync('yarn rw-gen', { shell: true, stdio: 'inherit' })
      } catch (error) {
        // rw-gen is responsible for logging its own errors but we need to
        // make sure we exit with a non-zero exit code
        process.exitCode = error.exitCode ?? 1
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
