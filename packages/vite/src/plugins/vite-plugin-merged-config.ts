import type { Plugin } from 'vite'

import { getConfig, getPaths } from '@cedarjs/project-config'

import { getMergedConfig } from '../lib/getMergedConfig.js'

export function cedarMergedConfig(): Plugin {
  const rwPaths = getPaths()
  const rwConfig = getConfig()

  return {
    name: 'vite-plugin-cedar',

    // Using the config hook here lets us modify the config but returning
    // plugins will **not** work
    config: getMergedConfig(rwConfig, rwPaths),
  }
}
