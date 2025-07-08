import path from 'node:path'

import { build } from 'vite'
import { describe, expect, it } from 'vitest'

import { cedarjsDirectoryNamedImportPlugin } from '../vite-plugin-cedarjs-directory-named-import.js'

const rootDir = path.join(__dirname, '__fixtures__', 'directory-named-imports')

async function testTransformation(fileName: string) {
  const result = await build({
    root: rootDir,
    plugins: [cedarjsDirectoryNamedImportPlugin()],
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
  return chunk.code
}

describe('directory named imports', () => {
  it('should transform directory named imports', async () => {
    const code = await testTransformation('moduleImport.js')

    expect(code).toMatchInlineSnapshot(`
      "const ImpModule = { name: "ImpModule" };
      console.log(ImpModule);
      "
    `)
  })

  it('should transform directory named imports TSX', async () => {
    const code = await testTransformation('tsxImport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const ImpTSX = () => null;
      console.log(ImpTSX);
      "
    `)
  })

  it('should transform directory named exports', async () => {
    const code = await testTransformation('moduleExport.js')

    expect(code).toMatchInlineSnapshot(`
      "const ImpModule = { name: "ImpModule" };
      export {
        ImpModule
      };
      "
    `)
  })

  it('should give preferences to index files', async () => {
    const code = await testTransformation('indexModuleExport.js')

    expect(code).toMatchInlineSnapshot(`
      "const ExpIndex = "index.js";
      export {
        ExpIndex
      };
      "
    `)
  })

  it('should give preferences to index files with TypeScript', async () => {
    const code = await testTransformation('indexModuleExport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const TSWithIndex = "index.js";
      export {
        TSWithIndex
      };
      "
    `)
  })

  it('should support .ts files', async () => {
    const code = await testTransformation('tsImport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const pew = "pew";
      console.log(pew);
      "
    `)
  })

  it('should support .tsx files', async () => {
    const code = await testTransformation('tsxExport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const pew = () => "pew";
      export {
        pew
      };
      "
    `)
  })

  it('should support .jsx files', async () => {
    const code = await testTransformation('jsxExport.ts')

    expect(code).toMatchInlineSnapshot(`
      "const pew = () => "pew";
      export {
        pew
      };
      "
    `)
  })
})
