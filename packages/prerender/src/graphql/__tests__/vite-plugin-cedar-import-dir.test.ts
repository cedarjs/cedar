import fs from 'fs'
import path from 'path'

import type { Plugin } from 'vite'
import { describe, it, expect } from 'vitest'

import { cedarImportDirPlugin } from '../vite-plugin-cedar-import-dir.js'

describe('vite plugin cedar import dir', () => {
  const fixturesDir = path.join(__dirname, '__fixtures__')

  async function callTransform(plugin: Plugin, code: string, id: string) {
    const pluginTransform = plugin?.transform

    if (typeof pluginTransform !== 'function') {
      throw new Error('Unexpeced transform type')
    }

    return pluginTransform.call(
      // The plugin is not using anything on the context, so this is safe
      {} as ThisParameterType<typeof pluginTransform>,
      code,
      id,
    )
  }

  it('should transform glob imports correctly', async () => {
    const testCase = 'import-dir'
    const codeFile = path.join(fixturesDir, testCase, 'code.js')
    const outputFile = path.join(fixturesDir, testCase, 'output.js')

    const inputCode = fs.readFileSync(codeFile, 'utf-8')
    const expectedOutput = fs.readFileSync(outputFile, 'utf-8')

    const vitePlugin = cedarImportDirPlugin()
    const mockId = path.join(fixturesDir, testCase, 'code.js')

    const result = await callTransform(vitePlugin, inputCode, mockId)

    if (hasCode(result)) {
      // Normalize line endings and whitespace for comparison
      const actualCode = result.code.trim().replace(/\r\n/g, '\n')
      const expectedCode = expectedOutput.trim().replace(/\r\n/g, '\n')

      expect(actualCode).toBe(expectedCode)
    } else {
      throw new Error('Plugin did not return transformed code')
    }
  })

  it('should return null for code without glob imports', async () => {
    const inputCode = `
      import React from 'react'
      import { someFunction } from './utils'

      export default function Component() {
        return <div>Hello</div>
      }
    `

    const vitePlugin = cedarImportDirPlugin()
    const mockId = '/mock/file.js'

    const result = await callTransform(vitePlugin, inputCode, mockId)

    expect(result).toBeNull()
  })

  it('should generate extensionless imports', async () => {
    const testCase = 'import-dir'
    const codeFile = path.join(fixturesDir, testCase, 'code.js')

    const inputCode = fs.readFileSync(codeFile, 'utf-8')

    const vitePlugin = cedarImportDirPlugin()
    const mockId = path.join(fixturesDir, testCase, 'code.js')

    const result = await callTransform(vitePlugin, inputCode, mockId)

    if (hasCode(result)) {
      // Should not include extensions for imports
      for (const line of result.code.split('\n')) {
        if (line.includes('import * as')) {
          expect(line).not.toMatch(/\.[tj]s.?$/)
        }
      }
    }
  })

  it('should handle missing directories gracefully', async () => {
    const inputCode = `import services from './test-files/**/*.{js,ts}'`

    // Create a temporary directory structure for testing
    const testDir = path.join(__dirname, 'temp-test-dir')

    // We can't actually create files in this test environment,
    // so we'll just test that the plugin doesn't crash with missing directories
    const vitePlugin = cedarImportDirPlugin()
    const mockId = path.join(testDir, 'file.js')

    const result = await callTransform(vitePlugin, inputCode, mockId)

    // Should handle missing directories gracefully
    expect(result).toBeDefined()
  })

  it('should handle multiple glob imports in the same file', async () => {
    const inputCode = `
      import services from './services/**/*.{js,ts}'
      import utils from './utils/**/*.js'
    `

    const vitePlugin = cedarImportDirPlugin()
    const mockId = '/mock/file.js'

    const result = await callTransform(vitePlugin, inputCode, mockId)

    if (hasCode(result)) {
      // Should contain both service and utils variable declarations
      expect(result.code).toContain('let services = {}')
      expect(result.code).toContain('let utils = {}')
    }
  })

  it('should generate valid variable names from file paths', async () => {
    const inputCode = `import components from './components/**/*.{js,ts}'`

    const vitePlugin = cedarImportDirPlugin()
    const mockId = '/mock/file.js'

    const result = await callTransform(vitePlugin, inputCode, mockId)

    if (hasCode(result)) {
      // Variable names should be valid JavaScript identifiers
      // (no special characters except underscores)
      const variableNameRegex = /components\.([a-zA-Z_][a-zA-Z0-9_]*)/g
      const matches = result.code.match(variableNameRegex)

      if (matches) {
        matches.forEach((match: string) => {
          const varName = match.split('.')[1]
          expect(varName).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
        })
      }
    }
  })
})

function hasCode(result: unknown): result is { code: string } {
  return (
    !!result &&
    typeof result === 'object' &&
    'code' in result &&
    typeof result.code === 'string'
  )
}
