import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { build } from 'esbuild'

import { cedarjsAutoImportPlugin } from '../esbuild-plugin-cedarjs-auto-import'

describe('auto-import esbuild plugin', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'auto-import-test-'),
    )
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  const buildWithPlugin = async (input: string, declarations: any[]) => {
    const inputFile = path.join(tempDir, 'input.tsx')
    await fs.promises.writeFile(inputFile, input)

    const result = await build({
      entryPoints: [inputFile],
      bundle: false,
      write: false,
      plugins: [
        cedarjsAutoImportPlugin({
          declarations,
        }),
      ],
    })

    return result.outputFiles[0].text
  }

  describe('React default import', () => {
    it('should add React import when React is used but not imported', async () => {
      const input = `
const Component = () => {
  return React.createElement('div', null, 'Hello')
}
export default Component
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'React',
          path: 'react',
        },
      ])

      expect(output).toContain("import React from 'react'")
      expect(output).toContain('React.createElement')
    })

    it('should not add React import when React is already imported', async () => {
      const input = `
import React from 'react'

const Component = () => {
  return React.createElement('div', null, 'Hello')
}
export default Component
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'React',
          path: 'react',
        },
      ])

      // Should only have one React import
      const reactImports = output.match(/import React from 'react'/g)
      expect(reactImports).toHaveLength(1)
    })

    it('should not add React import when React is not used', async () => {
      const input = `
const Component = () => {
  return 'Hello'
}
export default Component
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'React',
          path: 'react',
        },
      ])

      expect(output).not.toContain("import React from 'react'")
    })
  })

  describe('gql default import', () => {
    it('should add gql import when gql is used but not imported', async () => {
      const input = `
const QUERY = gql\`
  query GetUsers {
    users {
      id
    }
  }
\`
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'gql',
          path: 'graphql-tag',
        },
      ])

      expect(output).toContain("import gql from 'graphql-tag'")
      expect(output).toContain('const QUERY = gql`')
    })

    it('should not add gql import when gql is already imported', async () => {
      const input = `
import gql from 'graphql-tag'

const QUERY = gql\`
  query GetUsers {
    users {
      id
    }
  }
\`
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'gql',
          path: 'graphql-tag',
        },
      ])

      // Should only have one gql import
      const gqlImports = output.match(/import gql from 'graphql-tag'/g)
      expect(gqlImports).toHaveLength(1)
    })
  })

  describe('named imports', () => {
    it('should add named import when member is used but not imported', async () => {
      const input = `
const QUERY = gql\`
  query GetUsers {
    users {
      id
    }
  }
\`
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          members: ['gql'],
          path: 'web/src/graphql/gql',
        },
      ])

      expect(output).toContain("import { gql } from 'web/src/graphql/gql'")
      expect(output).toContain('const QUERY = gql`')
    })

    it('should add multiple named imports when multiple members are used', async () => {
      const input = `
const hook = useQuery()
const mutation = useMutation()
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          members: ['useQuery', 'useMutation'],
          path: '@apollo/client',
        },
      ])

      expect(output).toContain(
        "import { useQuery, useMutation } from '@apollo/client'",
      )
    })

    it('should not add named import when member is already imported', async () => {
      const input = `
import { gql } from 'web/src/graphql/gql'

const QUERY = gql\`
  query GetUsers {
    users {
      id
    }
  }
\`
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          members: ['gql'],
          path: 'web/src/graphql/gql',
        },
      ])

      // Should only have one gql import
      const gqlImports = output.match(
        /import { gql } from 'web\/src\/graphql\/gql'/g,
      )
      expect(gqlImports).toHaveLength(1)
    })
  })

  describe('conditional imports', () => {
    it('should filter out false declarations', async () => {
      const input = `
const QUERY = gql\`
  query GetUsers {
    users {
      id
    }
  }
\`
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'gql',
          path: 'graphql-tag',
        },
        false, // This should be filtered out
        {
          members: ['someOtherFunction'],
          path: 'some-other-lib',
        },
      ])

      expect(output).toContain("import gql from 'graphql-tag'")
      expect(output).not.toContain('some-other-lib')
    })
  })

  describe('import positioning', () => {
    it('should insert imports after existing imports', async () => {
      const input = `
import React from 'react'
import { useState } from 'react'

const Component = () => {
  const query = gql\`query { users { id } }\`
  return React.createElement('div')
}
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'gql',
          path: 'graphql-tag',
        },
      ])

      const lines = output.split('\n')
      const reactImportIndex = lines.findIndex((line) =>
        line.includes("import React from 'react'"),
      )
      const useStateImportIndex = lines.findIndex((line) =>
        line.includes("import { useState } from 'react'"),
      )
      const gqlImportIndex = lines.findIndex((line) =>
        line.includes("import gql from 'graphql-tag'"),
      )

      expect(reactImportIndex).toBeLessThan(gqlImportIndex)
      expect(useStateImportIndex).toBeLessThan(gqlImportIndex)
    })

    it('should insert imports at the beginning when no existing imports', async () => {
      const input = `
const Component = () => {
  const query = gql\`query { users { id } }\`
  return React.createElement('div')
}
      `.trim()

      const output = await buildWithPlugin(input, [
        {
          default: 'React',
          path: 'react',
        },
        {
          default: 'gql',
          path: 'graphql-tag',
        },
      ])

      const lines = output.split('\n')
      expect(lines[0]).toContain('import')
      expect(lines[1]).toContain('import')
    })
  })

  describe('file types', () => {
    it('should handle .tsx files', async () => {
      const inputFile = path.join(tempDir, 'input.tsx')
      const input = `
const Component = () => {
  return <div>{React.version}</div>
}
      `.trim()

      await fs.promises.writeFile(inputFile, input)

      const result = await build({
        entryPoints: [inputFile],
        bundle: false,
        write: false,
        plugins: [
          cedarjsAutoImportPlugin({
            declarations: [
              {
                default: 'React',
                path: 'react',
              },
            ],
          }),
        ],
      })

      const output = result.outputFiles[0].text
      expect(output).toContain("import React from 'react'")
    })

    it('should handle .ts files', async () => {
      const inputFile = path.join(tempDir, 'input.ts')
      const input = `
const query = gql\`query { users { id } }\`
export { query }
      `.trim()

      await fs.promises.writeFile(inputFile, input)

      const result = await build({
        entryPoints: [inputFile],
        bundle: false,
        write: false,
        plugins: [
          cedarjsAutoImportPlugin({
            declarations: [
              {
                default: 'gql',
                path: 'graphql-tag',
              },
            ],
          }),
        ],
      })

      const output = result.outputFiles[0].text
      expect(output).toContain("import gql from 'graphql-tag'")
    })
  })
})
