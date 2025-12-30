import task from 'tasuku'
import type { TaskInnerAPI } from 'tasuku'

import moveGeneratorTemplates from './moveGeneratorTemplates'

export const command = 'move-generator-templates'
export const description =
  '(v2.3.x) Moves generator templates to `/generatorTemplates`'

export const handler = () => {
  task('Move Generator Templates', async ({ setError }: TaskInnerAPI) => {
    try {
      await moveGeneratorTemplates()
    } catch (e: any) {
      setError('Failed to codemod your project \n' + e?.message)
    }
  })
}
