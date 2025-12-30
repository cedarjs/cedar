import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - No types for .js files
import * as destroyCell from './destroy/cell/cell.js'
// @ts-expect-error - No types for .js files
import * as destroyComponent from './destroy/component/component.js'
// @ts-expect-error - No types for .js files
import * as destroyDirective from './destroy/directive/directive.js'
// @ts-expect-error - No types for .js files
import * as destroyFunction from './destroy/function/function.js'
// @ts-expect-error - No types for .js files
import * as destroyLayout from './destroy/layout/layout.js'
// @ts-expect-error - No types for .js files
import * as destroyPage from './destroy/page/page.js'
// @ts-expect-error - No types for .js files
import * as destroyScaffold from './destroy/scaffold/scaffold.js'
// @ts-expect-error - No types for .js files
import * as destroySdl from './destroy/sdl/sdl.js'
// @ts-expect-error - No types for .js files
import * as destroyService from './destroy/service/service.js'

export const command = 'destroy <type>'
export const aliases = ['d']
export const description = 'Rollback changes made by the generate command'

export const builder = (yargs: Argv) =>
  yargs
    .command(destroyCell)
    .command(destroyComponent)
    .command(destroyDirective)
    .command(destroyFunction)
    .command(destroyLayout)
    .command(destroyPage)
    .command(destroyScaffold)
    .command(destroySdl)
    .command(destroyService)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#destroy-alias-d',
      )}`,
    )
