import path from 'node:path'

import type { TaskInnerAPI } from 'tasuku'
import task from 'tasuku'

import { getPaths } from '@cedarjs/project-config'

import runTransform from '../../../lib/runTransform.js'

export const command = 'rename-rollup-options'
export const description =
  '(v9.x) Renames rollupOptions to rolldownOptions in your Vite config'

export const handler = () => {
  task(
    'Rename rollupOptions',
    async ({ setError, setOutput }: TaskInnerAPI) => {
      const viteConfig = getPaths().web.viteConfig

      if (!viteConfig) {
        setError('Could not find your web/vite.config file')
        return
      }

      await runTransform({
        transformPath: path.join(import.meta.dirname, 'renameRollupOptions.js'),
        targetPaths: [viteConfig],
      })

      setOutput('All done! Run `yarn cedar lint --fix` to prettify your code')
    },
  )
}
