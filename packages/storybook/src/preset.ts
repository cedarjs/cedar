import { createRequire } from 'node:module'
import path from 'node:path'

import type { PresetProperty } from 'storybook/internal/types'
// import { mergeConfig } from 'vite'
// import { cjsInterop } from 'vite-plugin-cjs-interop'
// import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { getPaths } from '@cedarjs/project-config'

// import { autoImports } from './plugins/auto-imports.js'
// import { mockAuth } from './plugins/mock-auth.js'
// import { mockRouter } from './plugins/mock-router.js'
// import { reactDocgen } from './plugins/react-docgen.js'
import type { StorybookConfig } from './types.js'

function getAbsolutePath(input: string) {
  const createdRequire = createRequire(import.meta.url)
  return path.dirname(
    createdRequire.resolve(path.join(input, 'package.json'), {
      paths: [getPaths().base],
    }),
  )
}

export const core: PresetProperty<'core'> = {
  builder: getAbsolutePath('@storybook/builder-vite'),
  renderer: getAbsolutePath('@storybook/react/preset'),
}

// export const previewAnnotations: StorybookConfig['previewAnnotations'] = (
//   entries = [],
// ) => {
//   const createdRequire = createRequire(import.meta.url)
//   return [...entries, createdRequire.resolve('./preview.js')]
// }

// const cedarProjectPaths = getPaths()

// export const viteFinal: StorybookConfig['viteFinal'] = async (config) => {
//   const { plugins = [] } = config

//   // Needs to run before the react plugin, so add to the front
//   plugins.unshift(reactDocgen())
//   plugins.unshift(nodePolyfills())

//   return mergeConfig(config, {
//     // This is necessary as it otherwise just points to the `web` directory,
//     // but it needs to point to `web/src`
//     root: cedarProjectPaths.web.src,
//     plugins: [
//       mockRouter(),
//       mockAuth(),
//       autoImports,
//       cjsInterop({
//         dependencies: ['@apollo/client/cache/*'],
//       }),
//     ],
//     resolve: {
//       alias: {
//         '~__REDWOOD__USER_ROUTES_FOR_MOCK': cedarProjectPaths.web.routes,
//         '~__REDWOOD__USER_WEB_SRC': cedarProjectPaths.web.src,
//       },
//     },
//   })
// }

export const viteFinal: NonNullable<StorybookConfig['viteFinal']> = async (
  config,
  { presets },
) => {
  const plugins = [...(config?.plugins ?? [])]

  // Add docgen plugin
  const { reactDocgen: reactDocgenOption, reactDocgenTypescriptOptions } =
    await presets.apply<any>('typescript', {})
  let typescriptPresent

  try {
    import.meta.resolve('typescript')
    typescriptPresent = true
  } catch {
    typescriptPresent = false
  }

  if (reactDocgenOption === 'react-docgen-typescript' && typescriptPresent) {
    plugins.push(
      (
        await import('@joshwooding/vite-plugin-react-docgen-typescript')
      ).default({
        ...reactDocgenTypescriptOptions,
        // We *need* this set so that RDT returns default values in the same format as react-docgen
        savePropValueAsString: true,
      }),
    )
  }

  // Add react-docgen so long as the option is not false
  if (typeof reactDocgenOption === 'string') {
    const { reactDocgen } = await import('./plugins/react-docgen')
    // Needs to run before the react plugin, so add to the front
    plugins.unshift(
      // If react-docgen is specified, use it for everything, otherwise only use it for non-typescript files
      await reactDocgen({
        include:
          reactDocgenOption === 'react-docgen'
            ? /\.(mjs|tsx?|jsx?)$/
            : /\.(mjs|jsx?)$/,
      }),
    )
  }

  return { ...config, plugins }
}
