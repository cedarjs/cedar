import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'

import { getWebSideDefaultBabelConfig } from '@cedarjs/babel-config'
import { getConfig } from '@cedarjs/project-config'
import {
  autoImportsPlugin,
  cedarJsRouterImportTransformPlugin,
  createAuthImportTransformPlugin,
} from '@cedarjs/testing/web/vitest'

import { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
import { cedarDataUriShim } from './plugins/vite-plugin-cedar-data-uri-shim.js'
import { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
import { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
import { cedarRemoveDevFatalErrorPage } from './plugins/vite-plugin-cedar-remove-dev-fatal-error-page.js'
import { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
import { cedarRoutesAutoLoaderPlugin } from './plugins/vite-plugin-cedar-routes-auto-loader.js'
import { cedarWaitForApiServer } from './plugins/vite-plugin-cedar-wait-for-api-server.js'
import { cedarjsResolveCedarStyleImportsPlugin } from './plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'
import { cedarTransformJsAsJsx } from './plugins/vite-plugin-jsx-loader.js'
import { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
import { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'

export { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
export { cedarCjsCompatPlugin } from './plugins/vite-plugin-cedar-cjs-compat.js'
export { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
export { handlerAlsWrappingPlugin } from './plugins/vite-plugin-handler-als-wrapping.js'
export { applyHandlerAlsWrapping } from './plugins/vite-plugin-handler-als-wrapping.js'
export { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
export { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
export { cedarImportDirPlugin } from './plugins/vite-plugin-cedar-import-dir.js'
export { cedarDataUriShim } from './plugins/vite-plugin-cedar-data-uri-shim.js'
export { cedarRemoveDevFatalErrorPage } from './plugins/vite-plugin-cedar-remove-dev-fatal-error-page.js'
export { cedarRoutesAutoLoaderPlugin } from './plugins/vite-plugin-cedar-routes-auto-loader.js'
export { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
export { cedarjsResolveCedarStyleImportsPlugin } from './plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'
export { cedarjsJobPathInjectorPlugin } from './plugins/vite-plugin-cedarjs-job-path-injector.js'
export { cedarTransformJsAsJsx } from './plugins/vite-plugin-jsx-loader.js'
export { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
export { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'
export { cedarUniversalDeployPlugin } from './plugins/vite-plugin-cedar-universal-deploy.js'
export { cedarWaitForApiServer } from './plugins/vite-plugin-cedar-wait-for-api-server.js'

type PluginOptions = {
  mode?: string | undefined
}

/**
 * Pre-configured vite plugin, with required config for CedarJS apps.
 */
export function cedar({ mode }: PluginOptions = {}): PluginOption[] {
  const cedarConfig = getConfig()

  const rscEnabled = cedarConfig.experimental?.rsc?.enabled

  const webSideDefaultBabelConfig = getWebSideDefaultBabelConfig({
    forVite: true,
  })

  const babelConfig = {
    ...webSideDefaultBabelConfig,
  }

  return [
    mode === 'test' && cedarJsRouterImportTransformPlugin(),
    mode === 'test' && createAuthImportTransformPlugin(),
    mode === 'test' && autoImportsPlugin(),
    cedarWaitForApiServer(),
    cedarDataUriShim(),
    cedarHtmlEnvPlugin(),
    cedarEntryInjectionPlugin(),
    cedarMergedConfig(),
    cedarjsResolveCedarStyleImportsPlugin(),
    cedarSwapApolloProvider(),
    cedarCellTransform(),
    cedarTransformJsAsJsx(),
    cedarRemoveFromBundle(),
    cedarRemoveDevFatalErrorPage(),
    // RSC handles route auto-loading differently in each build stage
    !rscEnabled && cedarRoutesAutoLoaderPlugin(),
    react({ babel: babelConfig }),
  ]
}

/** @deprecated Please use the named `cedar` export instead */
export default cedar
