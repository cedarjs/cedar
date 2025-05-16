#!/usr/bin/env node

import yargs from 'yargs'

import * as v2TsconfigForRouteHooks from './codemods/v2.3.x/tsconfigForRouteHooks/tsconfigForRouteHooks.yargs.js'
import * as v2ConfigureFastify from './codemods/v2.x.x/configureFastify/configureFastify.yargs.js'
import * as v2UpdateResolverTypes from './codemods/v2.x.x/updateResolverTypes/updateResolverTypes.yargs.js'
import * as v4UpdateClerkGetCurrentUser from './codemods/v4.2.x/updateClerkGetCurrentUser/updateClerkGetCurrentUser.yargs.js'
import * as v4UseArmor from './codemods/v4.x.x/useArmor/useArmor.yargs.js'
import * as v5CellQueryResult from './codemods/v5.x.x/cellQueryResult/cellQueryResult.yargs.js'
import * as v5DetectEmptyCells from './codemods/v5.x.x/detectEmptyCells/detectEmptyCells.yargs.js'
import * as v5RenameValidateWith from './codemods/v5.x.x/renameValidateWith/renameValidateWith.yargs.js'
import * as v5UpdateAuth0ToV2 from './codemods/v5.x.x/updateAuth0ToV2/updateAuth0ToV2.yargs.js'
import * as v5UpdateNodeEngineTo18 from './codemods/v5.x.x/updateNodeEngineTo18/updateNodeEngineTo18.yargs.js'
import * as v5UpgradeToReact18 from './codemods/v5.x.x/upgradeToReact18/upgradeToReact18.yargs.js'
import * as v6GlobalThis from './codemods/v6.x.x/changeGlobalToGlobalThis/changeGlobalToGlobalThis.yargs.js'
import * as v6Jsx from './codemods/v6.x.x/convertJsToJsx/convertJsToJsx.yargs.js'
import * as v6EntryClient from './codemods/v6.x.x/entryClientNullCheck/entryClientNullCheck.yargs.js'
import * as v6EnvDot from './codemods/v6.x.x/processEnvDotNotation/processEnvDotNotation.yargs.js'
import * as v6Svgs from './codemods/v6.x.x/replaceComponentSvgs/replaceComponentSvgs.yargs.js'
import * as v6DevFatalErrorPage from './codemods/v6.x.x/updateDevFatalErrorPage/updateDevFatalErrorPage.yargs.js'
import * as v6ThemeConfig from './codemods/v6.x.x/updateThemeConfig/updateThemeConfig.yargs.js'
import * as v7Gql from './codemods/v7.x.x/updateGraphQLConfig/updateGraphqlConfig.yargs.js'

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs
  .scriptName('codemods')
  .example([['$0 add-directives', 'Run the add-directives codemod']])
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
  .strict().argv
