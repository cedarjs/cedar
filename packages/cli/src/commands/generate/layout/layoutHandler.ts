import { transformTSToJSMap } from '../../../lib/index.js'
import { removeGeneratorName } from '../helpers.js'
import {
  createHandler,
  templateForComponentFile,
} from '../yargsHandlerHelpers.js'
import type { HandlerArgv } from '../yargsHandlerHelpers.js'

const COMPONENT_SUFFIX = 'Layout'
const CEDAR_WEB_PATH_NAME = 'layouts'

type LayoutArgv = HandlerArgv & {
  typescript?: boolean
  skipLink?: boolean
}

export const files = async ({
  name,
  typescript = false,
  ...options
}: LayoutArgv): Promise<Record<string, string>> => {
  const layoutName = removeGeneratorName(name, 'layout')
  const extension = typescript ? '.tsx' : '.jsx'
  const layoutFile = await templateForComponentFile({
    name: layoutName,
    suffix: COMPONENT_SUFFIX,
    webPathSection: CEDAR_WEB_PATH_NAME,
    extension,
    generator: 'layout',
    templatePath: options.skipLink
      ? 'layout.tsx.a11y.template'
      : 'layout.tsx.template',
  })
  const testFile = await templateForComponentFile({
    name: layoutName,
    suffix: COMPONENT_SUFFIX,
    extension: `.test${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'layout',
    templatePath: 'test.tsx.template',
  })
  const storyFile = await templateForComponentFile({
    name: layoutName,
    suffix: COMPONENT_SUFFIX,
    extension: `.stories${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'layout',
    templatePath: 'stories.tsx.template',
  })

  const files = [layoutFile]
  if (options.stories) {
    files.push(storyFile)
  }

  if (options.tests) {
    files.push(testFile)
  }

  return transformTSToJSMap(files, typescript)
}

export const handler = createHandler({
  componentName: 'layout',
  filesFn: files,
})
