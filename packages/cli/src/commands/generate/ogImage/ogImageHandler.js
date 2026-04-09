import fs from 'node:fs'
import path from 'node:path'

import fg from 'fast-glob'
import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { ensurePosixPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  generateTemplate,
  getPaths,
  transformTSToJS,
  writeFilesTask,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { customOrDefaultTemplatePath } from '../yargsHandlerHelpers.js'

export const files = async ({ pagePath, typescript = false }) => {
  const extension = typescript ? '.tsx' : '.jsx'
  const componentOutputPath = path.join(
    getPaths().web.pages,
    pagePath + '.og' + extension,
  )
  const fullTemplatePath = customOrDefaultTemplatePath({
    generator: 'ogImage',
    templatePath: 'ogImage.og.tsx.template',
    side: 'web',
  })
  const content = await generateTemplate(fullTemplatePath, {
    name: 'ogImage',
    outputPath: ensurePosixPath(
      `./${path.relative(getPaths().base, componentOutputPath)}`,
    ),
    pageName: pagePath.split('/').pop(),
  })
  const template = typescript
    ? content
    : await transformTSToJS(componentOutputPath, content)

  return {
    [componentOutputPath]: template,
  }
}

export const normalizedPath = (pagePath) => {
  const parts = pagePath.split('/')

  // did it start with a leading `pages/`?
  if (parts[0] === 'pages') {
    parts.shift()
  }

  // is it JUST the name of the page, no parent directory?
  if (parts.length === 1) {
    return [parts[0], parts[0]].join('/')
  }

  // there's at least one directory, so now just be sure to double up on the page/subdir name
  if (parts[parts.length - 1] === parts[parts.length - 2]) {
    return parts.join('/')
  } else {
    const dir = parts.pop()
    return [...parts, dir, dir].join('/')
  }
}

export const validatePath = async (pagePath, extension, options) => {
  const finalPath = `${pagePath}.${extension}`

  // Optionally pass in a file system to make things easier to test!
  const pages = await fg(finalPath, {
    cwd: getPaths().web.pages,
    fs: options?.fs || fs,
  })

  if (!pages.length) {
    throw Error(`The page ${path.join(pagePath)}.${extension} does not exist`)
  }

  return true
}

export const handler = async (options) => {
  recordTelemetryAttributes({
    command: `generate og-image`,
    verbose: options.verbose,
    rollback: options.rollback,
    force: options.force,
  })

  const normalizedPagePath = normalizedPath(options.path)
  const extension = options.typescript ? 'tsx' : 'jsx'

  try {
    await validatePath(normalizedPagePath, extension)

    const tasks = new Listr(
      [
        {
          title: `Generating og:image component...`,
          task: async () => {
            const f = await files({
              pagePath: normalizedPagePath,
              typescript: options.typescript,
            })
            return writeFilesTask(f, { overwriteExisting: options.force })
          },
        },
      ],
      {
        rendererOptions: { collapseSubtasks: false },
        exitOnError: true,
        renderer: options.verbose && 'verbose',
      },
    )

    if (options.rollback && !options.force) {
      prepareForRollback(tasks)
    }
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
