import { createRequire } from 'node:module'
import path from 'node:path'

import {
  getWebSideDefaultBabelConfig,
  registerApiSideBabelHook,
} from '@cedarjs/babel-config'
import { getPaths } from '@cedarjs/project-config'

// This function is used both by the "exec" and "prerender" commands
export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}) {
  const createdRequire = createRequire(import.meta.url)
  const script = createdRequire(scriptPath)
  const returnValue = await script[functionName](args)

  try {
    const { db } = createdRequire(path.join(getPaths().api.lib, 'db'))
    db.$disconnect()
  } catch (e) {
    // silence
  }

  return returnValue
}

export function configureBabel() {
  const {
    overrides: _overrides,
    plugins: webPlugins,
    ...otherWebConfig
  } = getWebSideDefaultBabelConfig()

  // Import babel config for running script
  registerApiSideBabelHook({
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            $api: getPaths().api.base,
            $web: getPaths().web.base,
            api: getPaths().api.base,
            web: getPaths().web.base,
          },
          loglevel: 'silent', // to silence the unnecessary warnings
        },
        'exec-$side-module-resolver',
      ],
    ],
    overrides: [
      {
        test: ['./api/'],
        plugins: [
          [
            'babel-plugin-module-resolver',
            {
              alias: {
                src: getPaths().api.src,
              },
              loglevel: 'silent',
            },
            'exec-api-src-module-resolver',
          ],
        ],
      },
      {
        test: ['./web/'],
        plugins: [
          ...webPlugins,
          [
            'babel-plugin-module-resolver',
            {
              alias: {
                src: getPaths().web.src,
              },
              loglevel: 'silent',
            },
            'exec-web-src-module-resolver',
          ],
        ],
        ...otherWebConfig,
      },
    ],
  })
}
