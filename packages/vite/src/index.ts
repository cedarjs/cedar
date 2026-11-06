import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'
import { gqlPlugin as gqlTagPlugin } from 'vite-plugin-graphql-tag'

import { getConfig } from '@cedarjs/project-config'
import {
  autoImportsPlugin,
  cedarJsRouterImportTransformPlugin,
  cedarVitestWebConfigPlugin,
  createAuthImportTransformPlugin,
} from '@cedarjs/testing/web/vitest'

import { cedarApiImportGuardPlugin } from './plugins/vite-plugin-cedar-api-import-guard.js'
import { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
import { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
import { cedarDataUriShim } from './plugins/vite-plugin-cedar-data-uri-shim.js'
import { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
import { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
import { cedarMockCellDataPlugin } from './plugins/vite-plugin-cedar-mock-cell-data.js'
import { cedarParsedScalarsPlugin } from './plugins/vite-plugin-cedar-parsed-scalars.js'
import { cedarRemoveDevFatalErrorPage } from './plugins/vite-plugin-cedar-remove-dev-fatal-error-page.js'
import { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
import { cedarRoutesAutoLoaderPlugin } from './plugins/vite-plugin-cedar-routes-auto-loader.js'
import { cedarWaitForApiServer } from './plugins/vite-plugin-cedar-wait-for-api-server.js'
import { cedarjsResolveCedarStyleImportsPlugin } from './plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'
import { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
import { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'

export { cedarApiImportGuardPlugin } from './plugins/vite-plugin-cedar-api-import-guard.js'
export { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
export { cedarCjsCompatPlugin } from './plugins/vite-plugin-cedar-cjs-compat.js'
export { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
export { cedarGqlormInjectPlugin } from './plugins/vite-plugin-cedar-gqlorm-inject.js'
export { cedarGraphqlOptionsExtractPlugin } from './plugins/vite-plugin-cedar-graphql-options-extract.js'
export { cedarOtelWrappingPlugin } from './plugins/vite-plugin-cedar-otel-wrapping.js'
export {
  applyHandlerAlsWrapping,
  handlerAlsWrappingPlugin,
} from './plugins/vite-plugin-handler-als-wrapping.js'
export { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
export { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
export { cedarDirectoryNamedImportPlugin } from './plugins/vite-plugin-cedar-directory-named-import.js'
export { cedarImportDirPlugin } from './plugins/vite-plugin-cedar-import-dir.js'
export { cedarDataUriShim } from './plugins/vite-plugin-cedar-data-uri-shim.js'
export { cedarRemoveDevFatalErrorPage } from './plugins/vite-plugin-cedar-remove-dev-fatal-error-page.js'
export { cedarRoutesAutoLoaderPlugin } from './plugins/vite-plugin-cedar-routes-auto-loader.js'
export { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
export { cedarjsResolveCedarStyleImportsPlugin } from './plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'
export { cedarjsJobPathInjectorPlugin } from './plugins/vite-plugin-cedarjs-job-path-injector.js'
export { cedarMockCellDataPlugin } from './plugins/vite-plugin-cedar-mock-cell-data.js'
export { cedarParsedScalarsPlugin } from './plugins/vite-plugin-cedar-parsed-scalars.js'
export { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
export { cedarNetlifySkewProtectionPlugin } from './plugins/vite-plugin-cedar-netlify-skew-protection.js'
export { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'
export { cedarUniversalDeployPlugin } from './plugins/vite-plugin-cedar-universal-deploy.js'
export { cedarWaitForApiServer } from './plugins/vite-plugin-cedar-wait-for-api-server.js'

type PluginOptions = {
  mode?: string | undefined
}

/**
 * Pre-configured vite plugin, with required config for CedarJS apps.
 */
export function cedar(options: PluginOptions = {}): PluginOption[] {
  // Configs written in JavaScript aren't type checked, so an unsupported
  // `babel` option fails the build here instead of being silently ignored
  if ('babel' in options) {
    throw new Error(
      "`cedar()` doesn't take a `babel` option. Cedar builds your web side " +
        'with Vite, which compiles TypeScript and JSX without Babel.\n\n' +
        'Remove the `babel` option from `cedar()` in your Vite config. If you ' +
        'still need a Babel plugin, add `@rolldown/plugin-babel` to your ' +
        'Vite config as a plugin of its own. See ' +
        'https://cedarjs.com/docs/vite-configuration#custom-babel-plugins',
    )
  }

  const { mode } = options
  const cedarConfig = getConfig()

  const rscEnabled = cedarConfig.experimental?.rsc?.enabled

  const reactCompilerEnabled =
    cedarConfig.experimental?.reactCompiler?.enabled &&
    cedarConfig.experimental?.reactCompiler?.lintOnly === false

  return [
    cedarApiImportGuardPlugin(),
    gqlTagPlugin(),
    mode === 'test' && cedarJsRouterImportTransformPlugin(),
    mode === 'test' && createAuthImportTransformPlugin(),
    mode === 'test' && autoImportsPlugin(),
    mode === 'test' && cedarVitestWebConfigPlugin(),
    cedarWaitForApiServer(),
    cedarDataUriShim(),
    cedarHtmlEnvPlugin(),
    cedarEntryInjectionPlugin(),
    cedarMergedConfig(),
    cedarjsResolveCedarStyleImportsPlugin(),
    cedarSwapApolloProvider(),
    cedarParsedScalarsPlugin(),
    cedarCellTransform(),
    cedarRemoveFromBundle(),
    cedarRemoveDevFatalErrorPage(),
    // RSC handles route auto-loading differently in each build stage
    !rscEnabled && cedarRoutesAutoLoaderPlugin(),
    cedarMockCellDataPlugin(),
    cedarAutoImportsPlugin(),
    // React Compiler runs on `oxc-transform-react`, which
    // `yarn cedar experimental setup-react-compiler` installs
    react({ compiler: !!reactCompilerEnabled }),
  ]
}

/** @deprecated Please use the named `cedar` export instead */
export default cedar
