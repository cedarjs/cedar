import path from 'path'

import task from 'tasuku'

import { findCells } from '../../../lib/cells'
import runTransform from '../../../lib/runTransform'

export const command = 'cell-query-result'
export const description =
  '(v4.x.x->v5.x.x) Updates cells to use the `queryResult` property'

export const handler = () => {
  task('cellQueryResult', async ({ setOutput }) => {
    await runTransform({
      transformPath: path.join(__dirname, 'cellQueryResult.js'),
      targetPaths: findCells(),
    })

    setOutput(
      'Updates to your cells are complete! Please run `yarn cedar lint --fix` to prettify your code',
    )
  })
}
