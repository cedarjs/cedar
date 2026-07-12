import fs from 'node:fs'
import path from 'node:path'

import {
  getConfig,
  getPaths,
  importStatementPath,
} from '@cedarjs/project-config'

/**
 * Extracts the options argument from createGraphQLHandler calls and stores
 * them in an exported variable. Returns the transformed code, or null if no
 * transformation was needed.
 *
 * Transforms:
 *   export const handler = createGraphQLHandler({ options })
 * into:
 *   export const __cedar_graphqlOptions = { options }
 *   export const handler = createGraphQLHandler(__cedar_graphqlOptions)
 */
export function applyGraphqlOptionsExtract(code: string): string | null {
  // Check if already transformed
  if (code.includes('__cedar_graphqlOptions')) {
    return null
  }

  // Find export const handler = createGraphQLHandler(...)
  const exportHandlerPattern =
    /^export\s+const\s+(\w+)\s*=\s*createGraphQLHandler\s*\(/m

  const exportMatch = exportHandlerPattern.exec(code)
  if (!exportMatch) {
    return null
  }

  const exportIndex = exportMatch.index
  const exportName = exportMatch[1]
  // Position right after "createGraphQLHandler("
  const paramsStartPos = exportIndex + exportMatch[0].length

  // Extract the first argument by finding matching closing paren
  const optionsValue = extractFunctionArgument(code, paramsStartPos)

  if (!optionsValue) {
    return null
  }

  // Find the end of the entire export statement (the closing paren and possible
  // semicolon)
  const fullCallEndPos = paramsStartPos + optionsValue.length
  // Skip past the closing paren
  let statementEndPos = fullCallEndPos + 1

  // Skip optional whitespace on the same line (do not consume newlines)
  while (
    statementEndPos < code.length &&
    code[statementEndPos] !== '\n' &&
    /\s/.test(code[statementEndPos])
  ) {
    statementEndPos++
  }

  // Skip optional semicolon
  if (code[statementEndPos] === ';') {
    statementEndPos++
  }

  // Build the new code:
  // 1. Create the options constant before the handler export
  // 2. Replace the handler with the extracted options reference
  const optionsConst = `export const __cedar_graphqlOptions = ${optionsValue}\n`
  const newExport = `export const ${exportName} = createGraphQLHandler(__cedar_graphqlOptions)`

  const before = code.slice(0, exportIndex)
  const after = code.slice(statementEndPos)

  return before + optionsConst + newExport + after
}

/**
 * Injects the auto-generated gqlorm backend into graphql.ts at build time.
 *
 * When `experimental.gqlorm.enabled = true` and `.cedar/gqlorm/backend.ts`
 * exists, this function:
 *
 * 1. Adds imports at the top of graphql.ts:
 *      import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'
 *      import { db as __gqlorm_db__ } from 'src/lib/db'
 *
 * 2. Inserts a statement immediately before the `createGraphQLHandler` call:
 *      Object.assign(sdls, {
 *        __gqlorm__: {
 *          schema: __gqlorm_sdl__.schema,
 *          resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
 *        },
 *      })
 *
 * Returns the transformed code, or null if no transformation was needed.
 */
export function applyGqlormInject(
  code: string,
  id: string,
  ext: '.ts' | '.js' = '.ts',
): string | null {
  // Check if already transformed to prevent double-application
  if (code.includes('__gqlorm_sdl__')) {
    return null
  }

  // Quick check for createGraphQLHandler
  if (!code.includes('createGraphQLHandler')) {
    return null
  }

  // Check if gqlorm is enabled
  if (!getConfig().experimental?.gqlorm?.enabled) {
    return null
  }

  const backendPathWithoutExt = path.join(
    getPaths().generated.base,
    'gqlorm',
    'backend',
  )

  if (!fs.existsSync(backendPathWithoutExt + '.ts')) {
    return null
  }

  // Find the export const handler = createGraphQLHandler pattern
  const handlerPattern =
    /^export\s+const\s+(\w+)\s*=\s*createGraphQLHandler\s*\(/m

  const handlerMatch = handlerPattern.exec(code)
  if (!handlerMatch) {
    return null
  }

  const handlerLineStart = code.lastIndexOf('\n', handlerMatch.index) + 1

  // Compute the relative path from graphql.ts to the backend file
  // Use explicit extension for the generated imports. In dev mode (Vite SSR)
  // `.ts` is appropriate because Vite resolves TypeScript files natively. In
  // build mode (esbuild with bundle:false) the import ends up verbatim in the
  // output JS, so `.js` is needed to match the compiled dist files.
  const relPath =
    importStatementPath(
      path.relative(path.dirname(id), backendPathWithoutExt),
    ) + ext

  // Compute the relative path from graphql.ts to src/lib/db.
  // We cannot use the bare specifier 'src/lib/db' here because this function
  // runs after the Babel module-resolver has already rewritten all `src/` paths
  // to relative paths. A bare `src/lib/db` in the output would not be
  // resolvable by Node.js at runtime.
  const dbSrcPath = path.join(getPaths().api.src, 'lib', 'db')
  const relDbPath =
    importStatementPath(path.relative(path.dirname(id), dbSrcPath)) + ext

  // Build the imports to inject at the top of the file
  const importDb = `import { db as __gqlorm_db__ } from '${relDbPath}'`
  const importSdl = `import * as __gqlorm_sdl__ from '${relPath}'`
  const importsToAdd = `${importDb}\n${importSdl}\n`

  // Build the Object.assign mutation statement (with proper indentation)
  const sdlsMutation = `Object.assign(sdls, {
    __gqlorm__: {
      schema: __gqlorm_sdl__.schema,
      resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
    },
  })\n  `

  // Build the transformed code: prepend imports, then insert mutation before handler
  const transformed =
    importsToAdd +
    code.slice(0, handlerLineStart) +
    sdlsMutation +
    code.slice(handlerLineStart)

  return transformed
}

/**
 * Extracts a function argument starting at the given position.
 * Handles nested parens and braces independently.
 */
function extractFunctionArgument(code: string, startPos: number): string {
  let parenDepth = 0
  let braceDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = startPos; i < code.length; i++) {
    const char = code[i]

    // Handle strings: check if the quote is escaped by counting preceding backslashes
    if (char === '"' || char === "'" || char === '`') {
      // Count consecutive backslashes before this quote
      let backslashCount = 0
      for (let j = i - 1; j >= 0 && code[j] === '\\'; j--) {
        backslashCount++
      }

      // If even number of backslashes (including 0), the quote is not escaped
      const isEscaped = backslashCount % 2 === 1

      if (!isEscaped) {
        if (!inString) {
          inString = true
          stringChar = char
        } else if (char === stringChar) {
          inString = false
        }
      }

      continue
    }

    if (inString) {
      continue
    }

    if (char === '(') {
      parenDepth++
    } else if (char === ')') {
      if (parenDepth === 0 && braceDepth === 0) {
        // This is the closing paren of the createGraphQLHandler call
        return code.slice(startPos, i)
      }

      parenDepth--
    } else if (char === '{') {
      braceDepth++
    } else if (char === '}') {
      braceDepth--
    }
  }

  return ''
}
