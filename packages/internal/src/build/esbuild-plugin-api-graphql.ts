// esbuild plugin that runs the graphql.ts-specific transforms (options
// extraction + gqlorm injection + handler ALS wrapping + OTel wrapping)
// during the legacy esbuild API build. It's a separate onLoad so graphql
// concerns aren't buried inside cedar-esbuild-babel-transform.
//
// NOTE: esbuild 0.27 onLoad handlers are exclusive (first match wins), so this
// plugin is registered BEFORE runCedarBabelTransformsPlugin in getEsbuildOptions.
// Its narrow filter claims graphql.ts first, so the broad babel filter never
// reaches it. With esbuild >=0.28 we could instead use onTransform chaining, but
// 0.27 lacks that hook.

import fs from 'node:fs'
import path from 'node:path'

import type { PluginBuild } from 'esbuild'

import {
  getApiSideBabelConfigPath,
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import {
  applyGqlormInject,
  applyGraphqlOptionsExtract,
} from './api-graphql-transforms.js'
import { applyAutoImports } from './auto-import.js'
import { applyDirectoryNamedImport } from './directory-named-import.js'
import { applyOtelWrapping } from './esbuild-plugin-cedar-otel-wrapping.js'
import { applyHandlerAlsWrapping } from './esbuild-plugin-handler-als-wrapping.js'
import { applyEsmExtensions } from './esm-extensions.js'
import { applyImportDir } from './import-dir.js'
import { applySrcAlias } from './src-alias.js'
import { applyTsconfigPaths } from './tsconfig-paths.js'

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

      // Rewrite `src/` bare specifiers to relative paths before Babel runs.
      fileContents = applySrcAlias(
        fileContents,
        path.dirname(
          path.relative(build.initialOptions.absWorkingDir + '/src', args.path),
        ),
      )

      // Rewrite bare specifiers that match a user-defined tsconfig.json
      // `paths` alias to relative paths. Runs before applyDirectoryNamedImport
      // since a resolved alias can itself point at a directory that needs
      // directory-named-import resolution.
      fileContents = applyTsconfigPaths(
        fileContents,
        args.path,
        getPaths().api.base,
      )

      // Rewrite relative directory imports (e.g. `./Button`) to their index
      // or directory-named module file.
      fileContents = applyDirectoryNamedImport(fileContents, args.path)

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

      // Inject auto-imports for gql and context
      fileContents = applyAutoImports(fileContents)

      // Expand glob imports (e.g. `import x from 'src/services/**/*.ts'`)
      // before Babel runs.  The Babel import-dir plugin is disabled for these
      // builds (forVite: true); applyImportDir is the esbuild equivalent.
      fileContents =
        applyImportDir(fileContents, args.path)?.code ?? fileContents

      // The Babel pass is only needed to apply a user's custom
      // api/babel.config.js: getApiSideBabelPlugins({ forVite: true }) is
      // empty (the transforms above replace Cedar's api-side Babel plugins)
      // and esbuild strips TypeScript itself when given the 'ts' loader.
      const apiBabelConfigPath = getApiSideBabelConfigPath()

      let code = fileContents

      if (apiBabelConfigPath) {
        const transformedCode = await transformWithBabel(
          fileContents,
          args.path,
          getApiSideBabelPlugins({
            forVite: true,
            projectIsEsm: projectSideIsEsm('api'),
          }),
        )

        if (!transformedCode?.code) {
          throw new Error(`Could not transform file: ${args.path}`)
        }

        code = transformedCode.code
      }

      // For ESM projects, append .js to extensionless relative imports so
      // Node's ESM resolver can find them at runtime. applyImportDir expands
      // glob imports (e.g. `src/directives/**/*.ts`) into individual bare
      // specifiers without extensions; without this step those imports fail
      // at startup with ERR_MODULE_NOT_FOUND.
      if (projectSideIsEsm('api')) {
        code = applyEsmExtensions(code, args.path)
      }

      // Apply OTel wrapping and the handler ALS wrapping safeguard, replacing
      // the Babel plugins for these builds.
      if (
        cedarConfig.experimental?.opentelemetry?.enabled &&
        cedarConfig.experimental?.opentelemetry?.wrapApi
      ) {
        code = applyOtelWrapping(code, args.path, getPaths().api.src) ?? code
      }

      code =
        applyHandlerAlsWrapping(code, {
          projectIsEsm: projectSideIsEsm('api'),
        }) ?? code

      return {
        contents: code,
        // Babel output is always plain JS. Without Babel the contents are
        // still TypeScript when the source file is graphql.ts, so pick the
        // matching loader and let esbuild do the stripping. (The onLoad
        // filter only matches .ts and .js files.)
        loader: !apiBabelConfigPath && args.path.endsWith('.ts') ? 'ts' : 'js',
      }
    })
  },
}
