// helper used in Dev and Build commands

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getPrismaSchemas } from '@cedarjs/project-config'

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
 * Hashes the prisma config so changes to provider, output, etc. trigger
 * regeneration, and the schema content to detect model changes.
 */
async function computePrismaSchemaHash() {
  try {
    const hash = createHash('sha256')
    const configPath = getPaths().api.prismaConfig

    if (fs.existsSync(configPath)) {
      hash.update(fs.readFileSync(configPath))
    }

    const { schemas } = await getPrismaSchemas()

    for (const schema of schemas) {
      // `schema` is a tuple: [filePath: string, content: string]
      hash.update(schema[1])
    }

    return hash.digest('hex')
  } catch {
    // If we can't hash (e.g., invalid schema, @prisma/internals unavailable),
    // return null so the caller falls through to generation.
    return null
  }
}

function getHashFilePath(): string {
  const generatedBase = getPaths().generated.base

  return path.join(generatedBase, 'prisma-schema-hash')
}

function getStoredSchemaHash() {
  const hashFile = getHashFilePath()

  if (fs.existsSync(hashFile)) {
    return fs.readFileSync(hashFile, 'utf-8').trim()
  }

  return null
}

function storeSchemaHash(hash: string) {
  const hashFile = getHashFilePath()

  fs.mkdirSync(path.dirname(hashFile), { recursive: true })
  fs.writeFileSync(hashFile, hash)
}

/**
 * Conditionally generate the prisma client. Uses a schema hash stored in
 * `.cedar/prisma-schema-hash` to skip regeneration when the schema hasn't
 * changed
 */
export async function generatePrismaClient({
  verbose = true,
  silent = false,
}: GeneratePrismaClientOptions = {}) {
  const hash = await computePrismaSchemaHash()
  const storedHash = hash ? getStoredSchemaHash() : null

  if (hash !== null && hash === storedHash) {
    // Schema hasn't changed since last generate, skip.
    return
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

  if (hash !== null) {
    storeSchemaHash(hash)
  }
}
