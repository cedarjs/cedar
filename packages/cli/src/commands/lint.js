import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import execa from 'execa'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { getPaths } from '../lib/index.js'

const require = createRequire(import.meta.url)

/**
 * Resolves the formatter option, handling ESM formatters that export a default.
 * ESLint 8.x uses require() to load formatters, which doesn't properly handle
 * ESM modules with default exports. This function creates a wrapper if needed.
 *
 * @param {string} format - The formatter name or path
 * @param {string} cwd - The current working directory
 * @returns {string} The formatter name/path to use with ESLint
 */
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
        // Create a temporary wrapper file
        const wrapperPath = path.join(
          cwd,
          'node_modules',
          '.cache',
          'cedarjs',
          `formatter-${name.replace(/[^a-zA-Z0-9]/g, '-')}.cjs`,
        )

        // Ensure the directory exists
        fs.mkdirSync(path.dirname(wrapperPath), { recursive: true })

        // Write the wrapper that unwraps the default export
        const wrapperContent = `// Auto-generated wrapper for ESM formatter
const formatter = require(${JSON.stringify(formatterPath)});
module.exports = formatter.default || formatter;
`
        fs.writeFileSync(wrapperPath, wrapperContent)

        return wrapperPath
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

export const command = 'lint [path..]'
export const description = 'Lint your files'
export const builder = (yargs) => {
  yargs
    .positional('path', {
      description:
        'Specify file(s) or directory(ies) to lint relative to project root',
      type: 'array',
    })
    .option('fix', {
      default: false,
      description: 'Try to fix errors',
      type: 'boolean',
    })
    .option('format', {
      default: 'stylish',
      description: 'Use a specific output format',
      type: 'string',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#lint',
      )}`,
    )
}

export const handler = async ({ path, fix, format }) => {
  recordTelemetryAttributes({ command: 'lint', fix, format })

  try {
    const cwd = getPaths().base
    const resolvedFormat = resolveFormatter(format, cwd)

    const pathString = path?.join(' ')
    const sbPath = getPaths().web.storybook
    const args = [
      'eslint',
      fix && '--fix',
      '--format',
      resolvedFormat,
      !pathString && fs.existsSync(getPaths().web.src) && 'web/src',
      !pathString && fs.existsSync(getPaths().web.config) && 'web/config',
      !pathString && fs.existsSync(sbPath) && 'web/.storybook',
      !pathString && fs.existsSync(getPaths().scripts) && 'scripts',
      !pathString && fs.existsSync(getPaths().api.src) && 'api/src',
      pathString,
    ].filter(Boolean)

    const result = await execa('yarn', args, {
      cwd: getPaths().base,
      stdio: 'inherit',
    })

    process.exitCode = result.exitCode
  } catch (error) {
    process.exitCode = error.exitCode ?? 1
  }
}
