import { transformTSToJS } from '../../../lib/index.js'
import {
  createHandler,
  templateForComponentFile,
} from '../yargsHandlerHelpers.js'

const REDWOOD_WEB_PATH_NAME = 'components'

export const files = async ({
  name,
  typescript = false,
  ...argv
}: {
  name: string
  typescript?: boolean
  stories?: boolean
  tests?: boolean
  [key: string]: unknown
}): Promise<Record<string, string>> => {
  const extension = typescript ? '.tsx' : '.jsx'
  const componentFile = await templateForComponentFile({
    name,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    extension,
    generator: 'component',
    templatePath: 'component.tsx.template',
  })
  const testFile = await templateForComponentFile({
    name,
    extension: `.test${extension}`,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'component',
    templatePath: 'test.tsx.template',
  })
  const storiesFile = await templateForComponentFile({
    name,
    extension: `.stories${extension}`,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'component',
    // Using two different template files here because we have a TS-specific
    // information in a comment in the .tsx template
    templatePath: typescript ? 'stories.tsx.template' : 'stories.jsx.template',
  })

  const files = [componentFile]
  if (argv.stories) {
    files.push(storiesFile)
  }

  if (argv.tests) {
    files.push(testFile)
  }

  // Returns
  // {
  //    "path/to/fileA": "<<<template>>>",
  //    "path/to/fileB": "<<<template>>>",
  // }
  return files.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template = typescript
      ? content
      : await transformTSToJS(outputPath, content)

    return {
      [outputPath]: template,
      ...acc,
    }
  }, Promise.resolve({} as Record<string, string>))
}

export const handler = createHandler({
  componentName: 'component',
  filesFn: files,
})
