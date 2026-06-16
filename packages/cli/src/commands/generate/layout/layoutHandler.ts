import { transformTSToJSMap } from '../../../lib/index.js'
import { removeGeneratorName } from '../helpers.js'
import {
  templateForComponentFile,
  createHandler,
} from '../yargsHandlerHelpers.js'

const COMPONENT_SUFFIX = 'Layout'
const REDWOOD_WEB_PATH_NAME = 'layouts'

export const files = async ({
  name,
  typescript = false,
  ...options
}: {
  name: string
  typescript?: boolean
  skipLink?: boolean
  stories?: boolean
  tests?: boolean
  [key: string]: unknown
}): Promise<Record<string, string>> => {
  const layoutName = removeGeneratorName(name, 'layout')
  const extension = typescript ? '.tsx' : '.jsx'
  const layoutFile = await templateForComponentFile({
    name: layoutName,
    suffix: COMPONENT_SUFFIX,
    webPathSection: REDWOOD_WEB_PATH_NAME,
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
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'layout',
    templatePath: 'test.tsx.template',
  })
  const storyFile = await templateForComponentFile({
    name: layoutName,
    suffix: COMPONENT_SUFFIX,
    extension: `.stories${extension}`,
    webPathSection: REDWOOD_WEB_PATH_NAME,
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

  // Returns
  // {
  //    "path/to/fileA": "<<<template>>>",
  //    "path/to/fileB": "<<<template>>>",
  // }
  return transformTSToJSMap(files, typescript)
}

export const handler = createHandler({
  componentName: 'layout',
  filesFn: files,
})
