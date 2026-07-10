import type { Plugin } from 'vite'

/**
 * Vite plugin that extracts options passed to createGraphQLHandler into an
 * exported variable. This replaces `babel-plugin-cedar-graphql-options-extract`.
 *
 * Transforms:
 *   export const handler = createGraphQLHandler({ options })
 * into:
 *   export const __cedar_graphqlOptions = { options }
 *   export const handler = createGraphQLHandler(__cedar_graphqlOptions)
 *
 * This allows options to be imported elsewhere and enables the gqlorm-inject
 * plugin to mutate the sdls object in-place before the call.
 */
export function cedarGraphqlOptionsExtractPlugin(): Plugin {
  return {
    name: 'cedar-graphql-options-extract',
    transform(code, id) {
      // Only transform the graphql handler file.
      // Check for path separator to avoid matching e.g. notgraphql.ts.
      if (!id.endsWith('/graphql.ts')) {
        return null
      }

      // Quick check for createGraphQLHandler
      if (!code.includes('createGraphQLHandler')) {
        return null
      }

      // Check if already transformed
      if (code.includes('__cedar_graphqlOptions')) {
        return null
      }

      const transformed = extractGraphqlOptions(code)
      if (!transformed || transformed === code) {
        return null
      }

      return {
        code: transformed,
      }
    },
  }
}

/**
 * Extracts the options argument from createGraphQLHandler calls and stores
 * them in an exported variable. Returns the transformed code, or the original
 * code if no transformation was needed.
 */
function extractGraphqlOptions(code: string): string | null {
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

  // Find the end of the entire export statement (the closing paren and possible semicolon)
  const fullCallEndPos = paramsStartPos + optionsValue.length
  // Skip past the closing paren
  let statementEndPos = fullCallEndPos + 1 // +1 for the )

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
