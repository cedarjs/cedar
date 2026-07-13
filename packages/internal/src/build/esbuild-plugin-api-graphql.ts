// esbuild plugin that runs the graphql.ts-specific transforms (options
// extraction + gqlorm injection + handler ALS wrapping) during the legacy
// esbuild API build. It's a separate onLoad so graphql concerns aren't buried
// inside cedar-esbuild-babel-transform.
//
// NOTE: esbuild 0.27 onLoad handlers are exclusive (first match wins), so this
// plugin is registered BEFORE runCedarBabelTransformsPlugin in getEsbuildOptions.
// Its narrow filter claims graphql.ts first, so the broad babel filter never
// reaches it. With esbuild >=0.28 we could instead use onTransform chaining, but
// 0.27 lacks that hook.

import fs from 'node:fs'

import type { PluginBuild } from 'esbuild'

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getConfig, projectSideIsEsm } from '@cedarjs/project-config'

import {
  applyGqlormInject,
  applyGraphqlOptionsExtract,
} from './api-graphql-transforms.js'
import { applyHandlerAlsWrapping } from './esbuild-plugin-handler-als-wrapping.js'

export const cedarApiGraphqlPlugin = {
  name: 'cedar-api-graphql',
  setup(build: PluginBuild) {
    // Require a path separator before graphql.ts/.js so files like
    // notgraphql.ts are excluded. Use [/\\] to handle both forward slashes
    // (Unix) and backslashes (Windows), since esbuild uses platform-native
    // separators. Accept both .ts and .js since JS projects scaffold
    // graphql.js.
    build.onLoad({ filter: /[/\\]graphql\.(ts|js)$/ }, async (args) => {
      const cedarConfig = getConfig()
      let fileContents = await fs.promises.readFile(args.path, 'utf-8')

      // Apply graphql-specific string transforms on the raw TypeScript BEFORE
      // Babel CJS compilation. TypeScript always uses ESM syntax, so the ESM
      // patterns in applyGraphqlOptionsExtract and applyGqlormInject match here.
      // After Babel compiles to CJS, `export const handler = createGraphQLHandler(`
      // becomes `exports.handler = (0, _graphqlServer.createGraphQLHandler)(` and
      // the patterns no longer match.
      fileContents = applyGraphqlOptionsExtract(fileContents) ?? fileContents
      // Use '.js' extension for the db import: esbuild with bundle:false
      // compiles db.ts to db.js in dist/ but does not rewrite import paths.
      // The compiled graphql.js at runtime resolves the import relative to
      // api/dist/functions/, so it must point to api/dist/lib/db.js, not .ts.
      fileContents =
        applyGqlormInject(fileContents, args.path, '.js') ?? fileContents

      const transformedCode = await transformWithBabel(
        fileContents,
        args.path,
        getApiSideBabelPlugins({
          openTelemetry:
            cedarConfig.experimental.opentelemetry.enabled &&
            cedarConfig.experimental.opentelemetry.wrapApi,
          projectIsEsm: projectSideIsEsm('api'),
        }),
      )

      if (!transformedCode?.code) {
        throw new Error(`Could not transform file: ${args.path}`)
      }

      let code = transformedCode.code
      code =
        applyHandlerAlsWrapping(code, {
          projectIsEsm: projectSideIsEsm('api'),
        }) ?? code

      return {
        contents: code,
        loader: 'js',
      }
    })
  },
}
