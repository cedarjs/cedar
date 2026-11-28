import path from 'node:path'

import { langFromPath, parseSync } from '@swc-next/parser'
import type { Plugin } from 'vite'

export function rscReloadPlugin(fn: (type: 'full-reload') => void): Plugin {
  let enabled = false
  const isClientEntry = (id: string, code: string) => {
    const ext = path.extname(id)
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      const { program } = parseSync(code, {
        lang: langFromPath(id),
        comments: 'none',
      })

      return program.body.some(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression.type === 'Literal' &&
          statement.expression.value === 'use client',
      )
    }

    return false
  }

  return {
    name: 'reload-plugin',
    configResolved(config) {
      if (config.mode === 'development') {
        enabled = true
      }
    },
    async handleHotUpdate(ctx) {
      if (!enabled) {
        return []
      }

      if (ctx.modules.length && !isClientEntry(ctx.file, await ctx.read())) {
        return fn('full-reload')
      } else {
        return []
      }
    },
  }
}
