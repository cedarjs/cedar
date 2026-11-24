import path from 'node:path'

import { langFromPath, parseSync } from '@swc-next/parser'
import type { Node, Program } from '@swc-next/parser'
import { walk } from '@swc-next/walker'
import type { Plugin } from 'vite'

export function rscAnalyzePlugin(
  clientEntryCallback: (id: string) => void,
  serverEntryCallback: (id: string) => void,
): Plugin {
  return {
    name: 'redwood-rsc-analyze-plugin',
    transform(code, id) {
      const ext = path.extname(id)

      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        // TODO (RSC): In a larger codebase, see if we'd be any faster by doing
        // a simple code.includes('use client') || code.includes('use server')
        // check first before parsing the code

        const { program } = parseSync(code, {
          lang: langFromPath(id),
          comments: 'none',
        })

        let directiveFound = false

        for (const statement of program.body) {
          if (
            statement.type !== 'ExpressionStatement' ||
            statement.expression.type !== 'Literal'
          ) {
            continue
          }

          const directive = statement.expression.value
          if (directive === 'use client') {
            clientEntryCallback(id)
            directiveFound = true
          } else if (directive === 'use server') {
            serverEntryCallback(id)
            directiveFound = true
          }
        }

        if (
          !directiveFound &&
          code.includes('use server') &&
          containsServerAction(program)
        ) {
          serverEntryCallback(id)
        }
      }

      return code
    },
  }
}

function containsServerAction(program: Program): boolean {
  let found = false

  walk<Program, unknown, Node>(program, {
    Function(node, context) {
      const { parent, key } = context
      if (key === 'value') {
        // Scan constructor and object method bodies for nested server actions.
        if (parent?.type === 'MethodDefinition') {
          if (parent.kind !== 'constructor') {
            context.skip()
          }
          return
        }

        if (parent?.type === 'Property') {
          if (parent.kind === 'get' || parent.kind === 'set') {
            context.skip()
            return
          }
          if (parent.method) {
            return
          }
        }
      }

      if (
        node.body?.type === 'BlockStatement' &&
        node.body.body.some(
          (statement) =>
            statement.type === 'ExpressionStatement' &&
            statement.expression.type === 'Literal' &&
            statement.expression.value === 'use server',
        )
      ) {
        found = true
        context.stop()
      }
    },
  })

  return found
}
