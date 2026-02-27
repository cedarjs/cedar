#!/usr/bin/env node

import yargs from 'yargs'

import * as v2TsconfigForRouteHooks from './codemods/redwood/v2.3.x/tsconfigForRouteHooks/tsconfigForRouteHooks.yargs.js'
import * as v2ConfigureFastify from './codemods/redwood/v2.x.x/configureFastify/configureFastify.yargs.js'
import * as v2UpdateResolverTypes from './codemods/redwood/v2.x.x/updateResolverTypes/updateResolverTypes.yargs.js'
import * as v4UpdateClerkGetCurrentUser from './codemods/redwood/v4.2.x/updateClerkGetCurrentUser/updateClerkGetCurrentUser.yargs.js'
import * as v4UseArmor from './codemods/redwood/v4.x.x/useArmor/useArmor.yargs.js'
import * as v5CellQueryResult from './codemods/redwood/v5.x.x/cellQueryResult/cellQueryResult.yargs.js'
import * as v5DetectEmptyCells from './codemods/redwood/v5.x.x/detectEmptyCells/detectEmptyCells.yargs.js'
import * as v5RenameValidateWith from './codemods/redwood/v5.x.x/renameValidateWith/renameValidateWith.yargs.js'
import * as v5UpdateAuth0ToV2 from './codemods/redwood/v5.x.x/updateAuth0ToV2/updateAuth0ToV2.yargs.js'
import * as v5UpdateNodeEngineTo18 from './codemods/redwood/v5.x.x/updateNodeEngineTo18/updateNodeEngineTo18.yargs.js'
import * as v5UpgradeToReact18 from './codemods/redwood/v5.x.x/upgradeToReact18/upgradeToReact18.yargs.js'
import * as v6GlobalThis from './codemods/redwood/v6.x.x/changeGlobalToGlobalThis/changeGlobalToGlobalThis.yargs.js'
import * as v6Jsx from './codemods/redwood/v6.x.x/convertJsToJsx/convertJsToJsx.yargs.js'
import * as v6EntryClient from './codemods/redwood/v6.x.x/entryClientNullCheck/entryClientNullCheck.yargs.js'
import * as v6EnvDot from './codemods/redwood/v6.x.x/processEnvDotNotation/processEnvDotNotation.yargs.js'
import * as v6Svgs from './codemods/redwood/v6.x.x/replaceComponentSvgs/replaceComponentSvgs.yargs.js'
import * as v6DevFatalErrorPage from './codemods/redwood/v6.x.x/updateDevFatalErrorPage/updateDevFatalErrorPage.yargs.js'
import * as v6ThemeConfig from './codemods/redwood/v6.x.x/updateThemeConfig/updateThemeConfig.yargs.js'
import * as v7Gql from './codemods/redwood/v7.x.x/updateGraphQLConfig/updateGraphqlConfig.yargs.js'
import * as v2MoveGeneratorTemplates from './codemods/v2.3.x/moveGeneratorTemplates/moveGeneratorTemplates.yargs.js'
import * as v2PrismaV7Prep from './codemods/v2.7.x/prismaV7Prep/prismaV7Prep.yargs.js'

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs
  .scriptName('')
  .command(v2MoveGeneratorTemplates)
  .command(v2PrismaV7Prep)
  .command('redwood', 'List or run Redwood codemods', (yargs) => {
    return yargs
      .command(v2TsconfigForRouteHooks)
      .command(v2ConfigureFastify)
      .command(v2UpdateResolverTypes)
      .command(v4UpdateClerkGetCurrentUser)
      .command(v4UseArmor)
      .command(v5CellQueryResult)
      .command(v5DetectEmptyCells)
      .command(v5RenameValidateWith)
      .command(v5UpdateAuth0ToV2)
      .command(v5UpdateNodeEngineTo18)
      .command(v5UpgradeToReact18)
      .command(v6GlobalThis)
      .command(v6Jsx)
      .command(v6EntryClient)
      .command(v6EnvDot)
      .command(v6Svgs)
      .command(v6DevFatalErrorPage)
      .command(v6ThemeConfig)
      .command(v7Gql)
      .demandCommand()
      .strict()
  })
  .demandCommand()
  .epilog(
    [
      'Examples:',
      '  npx @cedarjs/codemods@latest <codemod>          Run a Cedar codemod',
      '  npx @cedarjs/codemods@latest redwood            List Redwood codemods',
      '  npx @cedarjs/codemods@latest redwood <codemod>  Run a Redwood codemod',
    ].join('\n'),
  )
  .strict().argv
