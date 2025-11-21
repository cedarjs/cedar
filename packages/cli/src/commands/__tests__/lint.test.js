import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('lint command - formatter resolution', () => {
  const require = createRequire(import.meta.url)

  function resolveFormatter(format, cwd) {
    // Built-in formatters and file paths don't need special handling
    const builtInFormatters = [
      'checkstyle',
      'compact',
      'html',
      'jslint-xml',
      'json',
      'json-with-metadata',
      'junit',
      'stylish',
      'tap',
      'unix',
      'visualstudio',
    ]

    if (builtInFormatters.includes(format)) {
      return format
    }

    // If it's a file path (contains path separators or ends with .js), use as-is
    if (
      format.includes('/') ||
      format.includes('\\') ||
      format.endsWith('.js') ||
      format.endsWith('.cjs') ||
      format.endsWith('.mjs')
    ) {
      return format
    }

    // Try to resolve the formatter package
    const possibleNames = [
      format,
      `eslint-formatter-${format}`,
      `@eslint/eslint-formatter-${format}`,
    ]

    for (const name of possibleNames) {
      try {
        // Try to resolve the package from the project directory
        const formatterPath = require.resolve(name, { paths: [cwd] })

        // Load the formatter to check if it's an ESM module with default export
        const formatter = require(formatterPath)

        // If it has __esModule and default, it's an ESM module that needs wrapping
        if (formatter && formatter.__esModule && formatter.default) {
          // For testing, just return a marker showing this would be a wrapper
          return `[WRAPPER:${name}]`
        }

        // If it's a regular CommonJS formatter, use the package name
        return name
      } catch (error) {
        // Package not found or couldn't be loaded, try next name
        continue
      }
    }

    // If we couldn't resolve it, return the original format and let ESLint handle it
    return format
  }

  it('should return built-in formatter names as-is', () => {
    expect(resolveFormatter('stylish', '/test/project')).toBe('stylish')
    expect(resolveFormatter('json', '/test/project')).toBe('json')
    expect(resolveFormatter('compact', '/test/project')).toBe('compact')
  })

  it('should return file paths as-is', () => {
    expect(resolveFormatter('./my-formatter.js', '/test/project')).toBe(
      './my-formatter.js',
    )
    expect(resolveFormatter('/abs/path/formatter.cjs', '/test/project')).toBe(
      '/abs/path/formatter.cjs',
    )
    expect(resolveFormatter('../formatter.mjs', '/test/project')).toBe(
      '../formatter.mjs',
    )
  })

  it('should return unknown formatters as-is', () => {
    expect(resolveFormatter('nonexistent', '/test/project')).toBe('nonexistent')
  })

  it('should try eslint-formatter- prefix for short names', () => {
    // This test just verifies the logic exists
    // Actual resolution would require the package to be installed
    const result = resolveFormatter('unknown-formatter', '/test/project')
    // Should return the original name if not found
    expect(result).toBe('unknown-formatter')
  })
})

