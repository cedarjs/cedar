import { transformTSToJSMap } from '../../../lib/index.js'
import {
  createHandler,
  templateForComponentFile,
} from '../yargsHandlerHelpers.js'
import type { TypescriptHandlerArgv } from '../yargsHandlerHelpers.js'

const CEDAR_WEB_PATH_NAME = 'components'

export const files = async ({
  name,
  typescript = false,
  stories,
  tests,
}: TypescriptHandlerArgv): Promise<Record<string, string>> => {
  const extension = typescript ? '.tsx' : '.jsx'
  const componentFile = await templateForComponentFile({
    name,
    webPathSection: CEDAR_WEB_PATH_NAME,
    extension,
    generator: 'component',
    templatePath: 'component.tsx.template',
  })
  const testFile = await templateForComponentFile({
    name,
    extension: `.test${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'component',
    templatePath: 'test.tsx.template',
  })
  const storiesFile = await templateForComponentFile({
    name,
    extension: `.stories${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'component',
    // Using two different template files here because we have a TS-specific
    // information in a comment in the .tsx template
    templatePath: typescript ? 'stories.tsx.template' : 'stories.jsx.template',
  })

  const files = [componentFile]
  if (stories) {
    files.push(storiesFile)
  }

  if (tests) {
    files.push(testFile)
  }

  return transformTSToJSMap(files, typescript)
}

export const handler = createHandler({
  componentName: 'component',
  filesFn: files,
})
