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

      // Find all createJob calls in export declarations
      const createJobCalls = root.findAll({
        rule: {
          pattern: 'export const $VAR_NAME = $OBJ.createJob($CONFIG)',
        },
      })

      for (const callNode of createJobCalls) {
        const varNameNode = callNode.getMatch('VAR_NAME')
        const configNode = callNode.getMatch('CONFIG')

        if (!varNameNode || !configNode) {
          continue
        }

        const importName = varNameNode.text()
        const importPath = path.relative(paths.api.jobs, id)
        const importPathWithoutExtension = importPath.replace(/\.[^/.]+$/, '')

        // Check if the config is an object expression
        if (configNode.kind() === 'object') {
          // Build the properties to insert
          const pathProperty = `path: ${JSON.stringify(importPathWithoutExtension)}`
          const nameProperty = `name: ${JSON.stringify(importName)}`

          // Find existing properties
          const properties = configNode.findAll({ rule: { kind: 'pair' } })

          let insertText = ''
          if (properties.length > 0) {
            // Insert after the last property
            insertText = `, ${pathProperty}, ${nameProperty}`
            const lastProperty = properties[properties.length - 1]
            const range = lastProperty.range()
            edits.push({
              startPos: range.end.index,
              endPos: range.end.index,
              insertedText: insertText,
            })
          } else {
            // Empty object, insert after the opening brace
            insertText = `${pathProperty}, ${nameProperty}`
            const configText = configNode.text()
            const openBraceIndex = configText.indexOf('{')

            if (openBraceIndex !== -1) {
              const range = configNode.range()
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
