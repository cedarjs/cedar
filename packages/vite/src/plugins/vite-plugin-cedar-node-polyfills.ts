import type { Plugin } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { getConfig } from '@cedarjs/project-config'

export function cedarNodePolyfills(): Plugin | undefined {
  // Only include the Buffer polyfill for non-rsc dev, for DevFatalErrorPage
  // Including the polyfill plugin in any form in RSC breaks

  if (getConfig().experimental?.rsc?.enabled) {
    return undefined
  }

  return {
    ...nodePolyfills({
      include: ['buffer'],
      globals: {
        Buffer: true,
      },
    }),
    apply: 'serve',
  }
}
