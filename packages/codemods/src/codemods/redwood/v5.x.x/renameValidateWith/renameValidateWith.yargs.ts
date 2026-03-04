import path from 'path'

import task from 'tasuku'

import { getPaths } from '@cedarjs/project-config'

import getFilesWithPattern from '../../../../lib/getFilesWithPattern.js'
import runTransform from '../../../../lib/runTransform.js'

export const command = 'rename-validate-with'

export const description =
  '(v4.x.x->v5.x.x) Renames validateWith to validateWithSync'

export const handler = () => {
  task(
    'Renaming `validateWith` to `validateWithSync`',
    async ({ setOutput }) => {
      const redwoodProjectPaths = getPaths()

      const files = getFilesWithPattern({
        pattern: 'validateWith',
        filesToSearch: [redwoodProjectPaths.api.src],
      })

      await runTransform({
        transformPath: path.join(import.meta.dirname, 'renameValidateWith.js'),
        targetPaths: files,
      })

      setOutput('All done! Run `yarn cedar lint --fix` to prettify your code')
    },
  )
}
