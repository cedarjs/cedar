import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

import { getConfig, getPaths } from '@cedarjs/project-config'

/**
 * Vite plugin that injects the auto-generated gqlorm backend into
 * `api/src/functions/graphql.ts` at build time.
 *
 * When `experimental.gqlorm.enabled = true` and `.cedar/gqlorm/backend.ts`
 * exists, this plugin:
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
 * The `sdls` variable is already a `let` binding because
 * `vite-plugin-cedar-import-dir` transforms the glob import
 * `import sdls from 'src/graphql/**\/*.sdl.{js,ts}'` into `let sdls = {}`.
 *
 * This plugin is a no-op when gqlorm is disabled or the backend file does
 * not exist.
 */
export function cedarGqlormInjectPlugin(): Plugin {
  return {
    name: 'cedar-gqlorm-inject',
    transform(code, id) {
      // Only transform the graphql handler file
      if (!id.endsWith('graphql.ts') && !id.endsWith('graphql.tsx')) {
        return null
      }

      // Quick check for createGraphQLHandler
      if (!code.includes('createGraphQLHandler')) {
        return null
      }

      // Check if gqlorm is enabled
      let config: ReturnType<typeof getConfig>
      try {
        config = getConfig()
      } catch {
        return null
      }

      if (!config.experimental?.gqlorm?.enabled) {
        return null
      }

      // Check if the backend file exists
      let paths: ReturnType<typeof getPaths>
      try {
        paths = getPaths()
      } catch {
        return null
      }

      const backendPathWithoutExt = path.join(
        paths.generated.base,
        'gqlorm',
        'backend',
      )
      const backendTsExists = fs.existsSync(backendPathWithoutExt + '.ts')
      const backendJsExists = fs.existsSync(backendPathWithoutExt + '.js')
      const backendExists = backendTsExists || backendJsExists

      if (!backendExists) {
        return null
      }

      // Find the export const handler = createGraphQLHandler pattern
      const handlerPattern =
        /^export\s+const\s+(\w+)\s*=\s*createGraphQLHandler\s*\(/m

      const handlerMatch = handlerPattern.exec(code)
      if (!handlerMatch) {
        return null
      }

      const handlerLineStart = code.lastIndexOf('\n', handlerMatch.index!) + 1

      // Find where all imports end
      let importsEndPos = 0
      const lines = code.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        // Stop at the first non-empty, non-import line
        if (line && !line.startsWith('import ')) {
          // Position is after the newline of the previous line
          importsEndPos = code.indexOf(lines[i])
          break
        }
      }

      // Compute the relative path from graphql.ts to the backend file
      const backendExt = backendTsExists ? '.ts' : '.js'
      const relPath =
        path
          .relative(path.dirname(id), backendPathWithoutExt)
          .replace(/\\/g, '/') + backendExt

      // Build the imports to inject
      const importDb = `import { db as __gqlorm_db__ } from 'src/lib/db'`
      const importSdl = `import * as __gqlorm_sdl__ from '${relPath}'`
      const importsToAdd = `${importDb}\n${importSdl}\n`

      // Build the Object.assign mutation statement (with proper indentation)
      const sdlsMutation = `Object.assign(sdls, {
    __gqlorm__: {
      schema: __gqlorm_sdl__.schema,
      resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
    },
  })\n  `

      // Build the transformed code
      const beforeImportEnd = code.slice(0, importsEndPos)
      const afterImportEnd = code.slice(importsEndPos, handlerLineStart)
      const fromHandlerLine = code.slice(handlerLineStart)

      const transformed =
        beforeImportEnd +
        importsToAdd +
        afterImportEnd +
        sdlsMutation +
        fromHandlerLine

      return {
        code: transformed,
      }
    },
  }
}
