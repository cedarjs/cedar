import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'

import { getWebSideDefaultBabelConfig } from '@cedarjs/babel-config'
import { getConfig } from '@cedarjs/project-config'

import { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
import { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
import { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
import { cedarNodePolyfills } from './plugins/vite-plugin-cedar-node-polyfills.js'
import { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
import { cedarTransformJsAsJsx } from './plugins/vite-plugin-jsx-loader.js'
import { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
import { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'

export { cedarCellTransform } from './plugins/vite-plugin-cedar-cell.js'
export { cedarEntryInjectionPlugin } from './plugins/vite-plugin-cedar-entry-injection.js'
export { cedarHtmlEnvPlugin } from './plugins/vite-plugin-cedar-html-env.js'
export { cedarNodePolyfills } from './plugins/vite-plugin-cedar-node-polyfills.js'
export { cedarRemoveFromBundle } from './plugins/vite-plugin-cedar-remove-from-bundle.js'
export { cedarjsDirectoryNamedImportPlugin } from './plugins/vite-plugin-cedarjs-directory-named-import.js'
export { cedarjsJobPathInjectorPlugin } from './plugins/vite-plugin-cedarjs-job-path-injector.js'
export { cedarTransformJsAsJsx } from './plugins/vite-plugin-jsx-loader.js'
export { cedarMergedConfig } from './plugins/vite-plugin-merged-config.js'
export { cedarSwapApolloProvider } from './plugins/vite-plugin-swap-apollo-provider.js'

/**
 * Pre-configured vite plugin, with required config for CedarJS apps.
 */
export function cedar(): PluginOption[] {
  const rwConfig = getConfig()

  const rscEnabled = rwConfig.experimental?.rsc?.enabled

  const webSideDefaultBabelConfig = getWebSideDefaultBabelConfig()

  const babelConfig = {
    ...webSideDefaultBabelConfig,
    // For RSC we don't want to include the routes auto-loader plugin as we
    // handle that differently in each specific RSC build stage
    overrides: rscEnabled
      ? webSideDefaultBabelConfig.overrides.filter((override) => {
          return !override.plugins?.some((plugin) => {
            return (
              Array.isArray(plugin) &&
              plugin[2] === 'babel-plugin-redwood-routes-auto-loader'
            )
          })
        })
      : webSideDefaultBabelConfig.overrides,
  }

  return [
    cedarNodePolyfills(),
    cedarHtmlEnvPlugin(),
    cedarEntryInjectionPlugin(),
    cedarMergedConfig(),
    cedarSwapApolloProvider(),
    cedarCellTransform(),
    cedarTransformJsAsJsx(),
    cedarRemoveFromBundle(),
    react({ babel: babelConfig }),
  ]
}

/** @deprecated - Please use the named `cedar` export instead */
export default cedar
