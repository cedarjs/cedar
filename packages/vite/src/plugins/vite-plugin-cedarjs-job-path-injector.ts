import path from 'node:path'

import { parse, Lang } from '@ast-grep/napi'
import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export function cedarjsJobPathInjectorPlugin(): Plugin {
  return {
    name: 'cedarjs-job-path-injector',
    transform(code, id) {
      // Quick check to see if this might be a job file
      if (!code.includes('createJob')) {
        return null
      }

      const isTypescript = id.endsWith('.ts') || id.endsWith('.tsx')
      const language = isTypescript ? Lang.TypeScript : Lang.JavaScript

      let ast
      try {
        ast = parse(language, code)
      } catch (error) {
        console.warn('Failed to parse file:', id)
        console.warn(error)

        // If we can't parse, just return the original code
        return null
      }

      const paths = getPaths()
      const edits = []

      const root = ast.root()

      // Find all createJob calls with object literal configs
      const createJobCalls = root.findAll({
        rule: {
          pattern: 'export const $VAR_NAME = $OBJ.createJob({ $$$PROPS })',
        },
      })

      for (const callNode of createJobCalls) {
        const varNameNode = callNode.getMatch('VAR_NAME')
        const propsNodes = callNode.getMultipleMatches('PROPS')

        if (!varNameNode) {
          continue
        }

        const importName = varNameNode.text()
        const importPath = path.relative(paths.api.jobs, id)
        const importPathWithoutExtension = importPath.replace(/\.[^/.]+$/, '')

        // Build the properties to insert
        const pathProperty = `path: ${JSON.stringify(importPathWithoutExtension)}`
        const nameProperty = `name: ${JSON.stringify(importName)}`

        let insertText = ''
        if (propsNodes.length > 0) {
          // Insert after the last property - find the actual object literal
          const objectLiteral = callNode.find({
            rule: {
              kind: 'object',
              inside: {
                kind: 'arguments',
              },
            },
          })

          if (objectLiteral) {
            insertText = `, ${pathProperty}, ${nameProperty}`
            // Find the position just before the closing brace
            const objectText = objectLiteral.text()
            const closeBraceIndex = objectText.lastIndexOf('}')
            if (closeBraceIndex !== -1) {
              const range = objectLiteral.range()
              edits.push({
                startPos: range.start.index + closeBraceIndex,
                endPos: range.start.index + closeBraceIndex,
                insertedText: insertText,
              })
            }
          }
        } else {
          // Empty object - find the object literal and insert between braces
          const objectLiteral = callNode.find({
            rule: {
              kind: 'object',
              inside: {
                kind: 'arguments',
              },
            },
          })

          if (objectLiteral) {
            insertText = `${pathProperty}, ${nameProperty}`
            const objectText = objectLiteral.text()
            const openBraceIndex = objectText.indexOf('{')
            if (openBraceIndex !== -1) {
              const range = objectLiteral.range()
              edits.push({
                startPos: range.start.index + openBraceIndex + 1,
                endPos: range.start.index + openBraceIndex + 1,
                insertedText: insertText,
              })
            }
          }
        }
      }

      if (edits.length === 0) {
        return null
      }

      // Apply modifications using ast-grep's commitEdits
      const modifiedCode = root.commitEdits(edits)

      return {
        code: modifiedCode,
        map: null,
      }
    },
  }
}
