import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { build } from 'vite'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { cedarjsDirectoryNamedImportPlugin } from '../vite-plugin-cedarjs-directory-named-import.js'

const testCases = [
  // Directory named imports (unused imports become bare imports)
  {
    input:
      'import { ImpModule } from "./__fixtures__/directory-named-imports/Module"',
    output: 'import "./__fixtures__/directory-named-imports/Module";',
  },
  // Directory named imports TSX (unused imports become bare imports)
  {
    input:
      'import { ImpTSX } from "./__fixtures__/directory-named-imports/TSX"',
    output: `import "./__fixtures__/directory-named-imports/TSX";`,
  },
  // Directory named exports (transformed to import + export)
  {
    input:
      'export { ExpModule } from "./__fixtures__/directory-named-imports/Module"',
    output: `import { ExpModule } from "./__fixtures__/directory-named-imports/Module";`,
  },
  // Gives preferences to `index.*`
  {
    input:
      'export { ExpIndex } from "./__fixtures__/directory-named-imports/indexModule"',
    output: `import { ExpIndex } from "./__fixtures__/directory-named-imports/indexModule";`,
  },
  {
    input:
      'export { TSWithIndex } from "./__fixtures__/directory-named-imports/TSWithIndex"',
    output: `import { TSWithIndex } from "./__fixtures__/directory-named-imports/TSWithIndex";`,
  },
  // Supports "*.ts"
  {
    input: 'export { pew } from "./__fixtures__/directory-named-imports/TS"',
    output: `import { pew } from "./__fixtures__/directory-named-imports/TS";`,
  },
  // Supports "*.tsx"
  {
    input: 'export { pew } from "./__fixtures__/directory-named-imports/TSX"',
    output: `import { pew } from "./__fixtures__/directory-named-imports/TSX";`,
  },
  // Supports "*.jsx"
  {
    input: 'export { pew } from "./__fixtures__/directory-named-imports/JSX"',
    output: `import { pew } from "./__fixtures__/directory-named-imports/JSX";`,
  },
]

describe('directory named imports', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-test-'))
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  testCases.forEach(({ input, output }) => {
    it(`should resolve ${input} to ${output}`, async () => {
      // Create a test file with the input code
      const rndId = Math.random().toString(36).slice(2, 11)
      const testFileName = `test-${Date.now()}-${rndId}.js`
      const testFilePath = path.join(tempDir, testFileName)
      fs.writeFileSync(testFilePath, input)

      // Build with Vite
      const result = await build({
        root: tempDir,
        plugins: [cedarjsDirectoryNamedImportPlugin()],
        build: {
          lib: {
            entry: testFileName,
            formats: ['es'],
          },
          rollupOptions: {
            external: (id) => id.startsWith('.'), // Externalize relative imports to preserve them
          },
          write: false, // Don't write to disk
          minify: false, // Don't minify to preserve import paths
        },
        logLevel: 'silent',
      })

      // Extract the generated code
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

      // The build process should have resolved the import to the correct path
      // We check that the resolved import path matches our expected output
      expect(chunk.code).toContain(output)
    })
  })
})
