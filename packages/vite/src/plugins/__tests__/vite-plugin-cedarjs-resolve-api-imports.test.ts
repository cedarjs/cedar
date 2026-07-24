import path from 'node:path'

import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cedarjsResolveCedarStyleImportsPlugin } from '../vite-plugin-cedarjs-resolve-cedar-style-imports.js'

const rootDir = path.join(__dirname, '__fixtures__', 'api-style-imports')

let originalCedarCwd: string | undefined

beforeAll(() => {
  // The api/ resolution needs getPaths() to find a project root
  originalCedarCwd = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = rootDir
})

afterAll(() => {
  if (originalCedarCwd === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = originalCedarCwd
  }
})

async function testTransformation(fileName: string) {
  const result = await build({
    root: rootDir,
    plugins: [cedarjsResolveCedarStyleImportsPlugin()],
    build: {
      lib: {
        entry: fileName,
        formats: ['es'],
      },
      write: false,
      minify: false,
    },
    logLevel: 'silent',
  })

  const outputBundle = Array.isArray(result) ? result[0] : result

  if (!('output' in outputBundle)) {
    throw new Error('Build output is not in expected format')
  }

  const chunk = outputBundle.output.find(
    (chunk) => chunk.type === 'chunk' && chunk.isEntry,
  )

  if (!chunk || !('code' in chunk)) {
    throw new Error('Could not find entry chunk in build output')
  }

  return chunk.code
}

describe('api/ bare-specifier imports', () => {
  it('resolves api/ imports to files under the api side', async () => {
    // Under yarn and npm, imports like
    // `import { PrismaClient } from 'api/db/generated/prisma/client.mts'`
    // happen to resolve through the root node_modules workspace symlink.
    // pnpm's strict isolation has no such link, so the plugin has to resolve
    // them itself
    const code = await testTransformation('apiImport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const PrismaClient = { name: "PrismaClient" };
      console.log(PrismaClient);
      "
    `)
  })
})
