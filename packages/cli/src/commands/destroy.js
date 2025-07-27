import { terminalLink } from 'termi-link'

import * as destroyCell from './destroy/cell/cell.js'
import * as destroyComponent from './destroy/component/component.js'
import * as destroyDirective from './destroy/directive/directive.js'
import * as destroyFunction from './destroy/function/function.js'
import * as destroyLayout from './destroy/layout/layout.js'
import * as destroyPage from './destroy/page/page.js'
import * as destroyScaffold from './destroy/scaffold/scaffold.js'
import * as destroySdl from './destroy/sdl/sdl.js'
import * as destroyService from './destroy/service/service.js'

export const command = 'destroy <type>'
export const aliases = ['d']
export const description = 'Rollback changes made by the generate command'
export const builder = (yargs) =>
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
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#destroy-alias-d',
      )}`,
    )
