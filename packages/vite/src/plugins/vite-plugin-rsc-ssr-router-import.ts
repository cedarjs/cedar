import path from 'node:path'

import babelGenerator from '@babel/generator'
const generate = babelGenerator
import { parse as babelParse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
const traverse = babelTraverse
import * as t from '@babel/types'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

/**
 * Transform `import { Router } from '@cedarjs/router/RscRouter'` to
 * `import { Router } from '@cedarjs/router/SsrRouter'`
 */
export function rscSsrRouterImport(): Plugin {
  // Vite IDs are always normalized and so we avoid windows path issues
  // by normalizing the path here.
  const routesFileId = normalizePath(getPaths().web.routes)

  return {
    name: 'rsc-ssr-router-import',
    transform: async function (code, id, options) {
      // We only care about the routes file
      if (!options?.ssr || id !== routesFileId) {
        return null
      }

      // Parse the code as AST
      const ext = path.extname(id)
      const plugins: any[] = []

      if (ext === '.jsx') {
        plugins.push('jsx')
      }

      const ast = babelParse(code, {
        sourceType: 'unambiguous',
        plugins,
      })

      traverse(ast, {
        ImportDeclaration(path) {
          const source = path.node.source.value
          if (source === '@cedarjs/router/RscRouter') {
            path.node.source = t.stringLiteral('@cedarjs/router/SsrRouter')
          }
        },
      })

      return generate(ast).code
    },
  }
}
