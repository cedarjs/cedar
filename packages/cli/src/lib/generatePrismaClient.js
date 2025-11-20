// helper used in Dev and Build commands

import { createRequire } from 'node:module'
import path from 'node:path'

import fs from 'fs-extra'

import { getSchemaPath } from '@cedarjs/project-config'

import { runCommandTask, getPaths } from '../lib/index.js'

const skipTask = async (schema) => {
  if (!schema) {
    schema = await getSchemaPath(getPaths().api.prismaConfig)
  }
  if (!fs.existsSync(schema)) {
    console.log(
      `Skipping database and Prisma client generation, no \`schema.prisma\` file found: \`${schema}\``,
    )
    return true
  }
  return false
}

export const generatePrismaCommand = async (schema) => {
  if (await skipTask(schema)) {
    return {}
  }

  const createdRequire = createRequire(import.meta.url)
  // I wanted to use `import.meta.resolve` here, but it's not supported by
  // vitest yet
  // https://github.com/vitest-dev/vitest/issues/6953
  // The path will be something like
  // /Users/tobbe/tmp/rx-test-project/node_modules/prisma/build/index.js
  const prismaIndexPath = createdRequire.resolve('prisma/build/index.js')

  return {
    cmd: `node "${prismaIndexPath}"`,
    args: ['generate', schema && `--schema="${schema}"`],
  }
}

/**
 * Conditionally generate the prisma client, skip if it already exists.
 */
export const generatePrismaClient = async ({
  verbose = true,
  force = true,
  silent = false,
  schema,
}) => {
  if (!schema) {
    schema = await getSchemaPath(getPaths().api.prismaConfig)
  }
  if (await skipTask(schema)) {
    return
  }

  // Do not generate the Prisma client if it exists.
  if (!force) {
    const prismaClientPath = path.join(
      getPaths().base,
      'node_modules/.prisma/client/index.js',
    )

    const prismaClientFile = fs.readFileSync(prismaClientPath, 'utf8')

    // This is a hack, and is likely to break. A better solution would be to
    // try to import the Prisma client. But that gets cached, so we'd have to
    // do it in a worker thread.
    // See https://github.com/nodejs/node/issues/49442#issuecomment-1703472299
    // for an idea on how to do that
    // Just reading the file and manually looking for known strings is faster
    // and works around the caching issue. But is less future proof. But it's
    // good enough for now.
    // If we want to go back to `await import(...)` we could try appending
    // `?cache_busting=${Date.now()}` to the URL.
    if (
      !prismaClientFile.includes('@prisma/client did not initialize yet.') &&
      prismaClientFile.includes('exports.Prisma.')
    ) {
      // Client exists, so abort.
      return
    }
  }

  await runCommandTask(
    [
      {
        title: 'Generating the Prisma client...',
        ...(await generatePrismaCommand(schema)),
      },
    ],
    {
      verbose,
      silent,
    },
  )
}
