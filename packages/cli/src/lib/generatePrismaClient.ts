// helper used in Dev and Build commands

import fs from 'node:fs'
import { createRequire } from 'node:module'

import { resolveGeneratedPrismaClient } from '@cedarjs/project-config'

// @ts-expect-error - No types for JS files
import { runCommandTask, getPaths } from './index.js'

type GeneratePrismaClientOptions = {
  verbose?: boolean
  force?: boolean
  silent?: boolean
}

export const generatePrismaCommand = async (): Promise<{
  cmd: string
  args: string[]
}> => {
  const createdRequire = createRequire(import.meta.url)

  // I wanted to use `import.meta.resolve` here, but it's not supported by our
  // version of vitest: https://github.com/vitest-dev/vitest/issues/6953
  // The path will be something like
  // /Users/tobbe/tmp/cedar-test-project/node_modules/prisma/build/index.js
  const prismaIndexPath = createdRequire.resolve('prisma/build/index.js')

  return {
    cmd: 'node',
    args: [
      prismaIndexPath,
      'generate',
      `--config=${getPaths().api.prismaConfig}`,
    ],
  }
}

/**
 * Conditionally generate the prisma client, skip if it already exists (unless
 * forced).
 */
export const generatePrismaClient = async ({
  verbose = true,
  force = true,
  silent = false,
}: GeneratePrismaClientOptions = {}): Promise<void> => {
  // Unless --force is used we do not generate the Prisma client if it exists.
  if (!force) {
    const { clientPath } = await resolveGeneratedPrismaClient()

    const prismaClientFile =
      clientPath && fs.existsSync(clientPath)
        ? fs.readFileSync(clientPath, 'utf8')
        : ''

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
    // TODO: Revisit this when we've switched to Prisma's new TS engine
    if (
      !prismaClientFile.includes('@prisma/client did not initialize yet.') &&
      (prismaClientFile.includes('exports.Prisma.') ||
        prismaClientFile.includes('export const PrismaClient'))
    ) {
      // Client exists, so abort.
      return
    }
  }

  await runCommandTask(
    [
      {
        title: 'Generating the Prisma client...',
        ...(await generatePrismaCommand()),
      },
    ],
    {
      verbose,
      silent,
    },
  )
}
