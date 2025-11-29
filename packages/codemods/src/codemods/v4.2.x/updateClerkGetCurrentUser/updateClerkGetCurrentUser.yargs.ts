import path from 'path'

import type { TaskInnerAPI } from 'tasuku'
import task from 'tasuku'

import { getPaths } from '@cedarjs/project-config'

import isTSProject from '../../../lib/isTSProject'
import runTransform from '../../../lib/runTransform'

export const command = 'update-clerk-get-current-user'
export const description =
  '(v4.1.x->v4.2.x) For Clerk users; updates the getCurrentUser function'

export const handler = () => {
  task('Update getCurrentUser', async ({ setOutput }: TaskInnerAPI) => {
    const authFile = isTSProject ? 'auth.ts' : 'auth.js'

    await runTransform({
      transformPath: path.join(__dirname, 'updateClerkGetCurrentUser.js'),
      targetPaths: [path.join(getPaths().api.base, 'src', 'lib', authFile)],
    })

    setOutput('All done! Run `yarn cedar lint --fix` to prettify your code')
  })
}
