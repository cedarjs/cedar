import fs from 'node:fs'
import path from 'node:path'

import type { BuildContext, BuildOptions, PluginBuild } from 'esbuild'
import { build, context } from 'esbuild'
import type { Plugin } from 'vite'
import { build as viteBuild, normalizePath } from 'vite'
import tsPathsMod from 'vite-tsconfig-paths'

// vite-tsconfig-paths is ESM-only. CJS builds double-wrap its default
// export: tsconfigPaths.default is the module object, and
// tsconfigPaths.default.default is the actual function. ESM gets the
// function directly. The `||` chain resolves correctly for both.
const tsconfigPaths =
  // @ts-expect-error – .default only exists at runtime in CJS double-wrap
  // interop
  tsPathsMod.default?.default || tsPathsMod.default || tsPathsMod

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import {
  getConfig,
  getPaths,
  projectSideIsEsm,
  resolveFile,
} from '@cedarjs/project-config'

import { findApiFiles } from '../files.js'

import {
  applyGqlormInject,
  applyGraphqlOptionsExtract,
} from './api-graphql-transforms.js'
import { applyAutoImports } from './auto-import.js'
import { applyDirectoryNamedImport } from './directory-named-import.js'
import { cedarApiGraphqlPlugin } from './esbuild-plugin-api-graphql.js'
import { applyOtelWrapping } from './esbuild-plugin-cedar-otel-wrapping.js'
import { applyHandlerAlsWrapping } from './esbuild-plugin-handler-als-wrapping.js'
import { applyImportDir } from './import-dir.js'
import { applySrcAlias } from './src-alias.js'
import { applyTsconfigPaths } from './tsconfig-paths.js'

let BUILD_CTX: BuildContext | null = null

export const buildApi = async () => {
  BUILD_CTX?.dispose()
  BUILD_CTX = null
  return transpileApi(findApiFiles())
}

export const rebuildApi = async () => {
  const apiFiles = findApiFiles()
  if (!BUILD_CTX) {
    BUILD_CTX = await context(getEsbuildOptions(apiFiles))
  }
  const result = await BUILD_CTX.rebuild()
  const cedarPaths = getPaths()
  await fixSourceMaps(cedarPaths.api.dist, cedarPaths.api.src)
  return result
}

export const cleanApiBuild = async () => {
  const cedarPaths = getPaths()
  return fs.promises.rm(cedarPaths.api.dist, { recursive: true, force: true })
}

const runCedarBabelTransformsPlugin = {
  name: 'cedar-esbuild-babel-transform',
  setup(build: PluginBuild) {
    build.onLoad({ filter: /\.(js|ts|tsx|jsx)$/ }, async (args) => {
      let fileContents = await fs.promises.readFile(args.path, 'utf-8')

      // Rewrite `src/` bare specifiers to relative paths and inject
      // auto-imports
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
      fileContents = applyAutoImports(fileContents)
      // Expand glob imports (e.g. `import x from 'src/services/**/*.ts'`)
      // before Babel runs.  The Babel import-dir plugin is disabled for these
      // builds (forVite: true); applyImportDir is the esbuild equivalent.
      //
      // This is intentionally applied inline rather than as a separate esbuild
      // plugin because esbuild 0.27 lacks onTransform chaining — onLoad
      // handlers are exclusive (first match wins), so a standalone pre-plugin
      // would claim the file and prevent this plugin's Babel transform from
      // running on the same file.
      fileContents =
        applyImportDir(fileContents, args.path)?.code ?? fileContents
      const transformedCode = await transformWithBabel(
        fileContents,
        args.path,
        getApiSideBabelPlugins({
          forVite: true,
          projectIsEsm: projectSideIsEsm('api'),
        }),
      )

      if (transformedCode?.code) {
        let code = transformedCode.code
        const normalizedPath = normalizePath(args.path)
        const cedarPaths = getPaths()
        const isEsm = projectSideIsEsm('api')

        // Apply OTel wrapping and the handler ALS wrapping safeguard to API
        // function handlers. These are the standalone-esbuild equivalents of
        // the Vite cedarOtelWrappingPlugin and handlerAlsWrappingPlugin,
        // replacing the Babel plugins for these builds. The ALS wrapping
        // plugin replaces the (Jest-only) Babel plugin it succeeded.
        // graphql.ts also lives in functions/ but is claimed by the dedicated
        // cedarApiGraphqlPlugin, which is registered before this plugin, so it
        // never reaches this branch.
        const functionsDir = normalizePath(cedarPaths.api.functions)
        if (normalizedPath.startsWith(functionsDir + '/')) {
          code =
            applyHandlerAlsWrapping(code, {
              projectIsEsm: isEsm,
            }) ?? code
        }

        if (
          normalizedPath.startsWith(normalizePath(cedarPaths.api.src) + '/')
        ) {
          code = applyOtelWrapping(code, args.path, cedarPaths.api.src) ?? code
        }

        return {
          contents: code,
          loader: 'js',
        }
      }

      throw new Error(`Could not transform file: ${args.path}`)
    })
  },
}

/**
 * Vite plugin that expands glob directory imports before the Babel transform
 * runs.  This is the buildApiWithVite equivalent of:
 *   - cedarImportDirPlugin  in @cedarjs/vite  (used by buildApp and exec)
 *   - applyImportDir        applied inline      (used by runCedarBabelTransformsPlugin)
 *
 * Inlined here to avoid a circular dependency (@cedarjs/internal ↔
 * @cedarjs/vite).  Code duplication is intentional.
 */
function createImportDirVitePlugin(): Plugin {
  return {
    name: 'cedar-internal-import-dir',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(js|ts|tsx|jsx)$/.test(id)) {
        return null
      }
      if (id.includes('node_modules')) {
        return null
      }
      const result = applyImportDir(code, id)
      if (!result) {
        return null
      }
      return { code: result.code, map: result.map }
    },
  }
}

/**
 * Vite plugin that resolves relative directory imports (e.g. `./Button`) to
 * their index or directory-named module file. This is the buildApiWithVite
 * equivalent of:
 *   - cedarDirectoryNamedImportPlugin  in @cedarjs/vite  (used by buildApp
 *     and apiDevMiddleware)
 *   - applyDirectoryNamedImport        applied inline      (used by
 *     runCedarBabelTransformsPlugin and cedarApiGraphqlPlugin)
 *
 * Inlined here to avoid a circular dependency (@cedarjs/internal ↔
 * @cedarjs/vite). Code duplication is intentional.
 */
function createDirectoryNamedImportVitePlugin(): Plugin {
  return {
    name: 'cedar-internal-directory-named-import',
    enforce: 'pre',
    resolveId(id, importer) {
      // Only handle relative imports
      if (!id.startsWith('.') || !importer) {
        return null
      }

      if (importer.includes('node_modules')) {
        return null
      }

      const absolutePath = path.resolve(path.dirname(importer), id)

      // If the import already points to a real file, leave it alone.
      if (resolveFile(absolutePath)) {
        return null
      }

      const indexPath = path.join(absolutePath, 'index')
      const resolvedIndex = resolveFile(indexPath)
      if (resolvedIndex) {
        return normalizePath(resolvedIndex)
      }

      const basename = path.basename(absolutePath)
      const dirNamedPath = path.join(absolutePath, basename)
      const resolvedDirNamed = resolveFile(dirNamedPath)
      if (resolvedDirNamed) {
        return normalizePath(resolvedDirNamed)
      }

      return null
    },
  }
}

function createCedarViteApiPlugin(): Plugin {
  const cedarConfig = getConfig()
  const isEsm = projectSideIsEsm('api')

  return {
    name: 'cedar-vite-api-babel-transform',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.(js|ts|tsx|jsx)$/.test(id)) {
        return null
      }

      if (id.includes('node_modules')) {
        return null
      }

      const cedarPaths = getPaths()
      if (!normalizePath(id).startsWith(normalizePath(cedarPaths.api.base))) {
        return null
      }

      let sourceCode = code
      const normalizedId = normalizePath(id)

      // Rewrite `src/` bare specifiers and inject auto-imports
      sourceCode = applySrcAlias(
        sourceCode,
        path.dirname(path.relative(cedarPaths.api.src, id)),
      )
      sourceCode = applyAutoImports(sourceCode)

      // Apply graphql-specific transforms on the raw TypeScript BEFORE
      // Babel CJS compilation. The ESM-pattern regexes in these
      // transforms require `export const handler = createGraphQLHandler(`
      // syntax, which Babel rewrites to CJS form when the project uses
      // "type": "commonjs". Running them first ensures the patterns
      // always match regardless of the project's module format.
      if (
        normalizedId.endsWith('/graphql.ts') ||
        normalizedId.endsWith('/graphql.js')
      ) {
        sourceCode = applyGraphqlOptionsExtract(sourceCode) ?? sourceCode
        sourceCode = applyGqlormInject(sourceCode, id) ?? sourceCode
      }

      const transformedCode = await transformWithBabel(
        sourceCode,
        id,
        getApiSideBabelPlugins({
          forVite: true,
          projectIsEsm: isEsm,
        }),
        true,
      )

      if (transformedCode?.code) {
        let code = transformedCode.code

        // Apply OTel wrapping to all API files.
        if (
          cedarConfig.experimental?.opentelemetry?.enabled &&
          cedarConfig.experimental?.opentelemetry?.wrapApi
        ) {
          code = applyOtelWrapping(code, id, cedarPaths.api.src) ?? code
        }

        // Apply the handler ALS wrapping safeguard to API function handlers.
        // This is the standalone-esbuild equivalent of the Vite
        // handlerAlsWrappingPlugin and the (Jest-only) babel plugin it
        // replaced.
        const functionsDir = normalizePath(cedarPaths.api.functions)
        if (normalizedId.startsWith(functionsDir + '/')) {
          code =
            applyHandlerAlsWrapping(code, {
              projectIsEsm: isEsm,
            }) ?? code
        }

        return {
          code,
          map: transformedCode.map ?? null,
        }
      }

      throw new Error(`Could not transform file: ${id}`)
    },
  }
}

export const buildApiWithVite = async () => {
  const cedarPaths = getPaths()
  const isEsm = projectSideIsEsm('api')
  const format = isEsm ? 'es' : 'cjs'
  const apiFiles = findApiFiles()

  const input: Record<string, string> = {}
  for (const f of apiFiles) {
    const key = path
      .relative(cedarPaths.api.src, f)
      .replace(/\.(ts|tsx|mts|js|jsx|mjs)$/, '')
    input[key] = f
  }

  return viteBuild({
    root: cedarPaths.api.base,
    logLevel: 'warn',
    build: {
      ssr: true,
      sourcemap: true,
      outDir: cedarPaths.api.dist,
      rollupOptions: {
        input,
        output: {
          format,
          preserveModules: true,
          preserveModulesRoot: cedarPaths.api.src,
          entryFileNames: '[name].js',
          // Directives (and other entry modules) intentionally use both named
          // and default exports (e.g. `export const schema` + `export default`).
          // Tell Rollup to expect this so it doesn't warn about mixed exports.
          exports: 'named',
        },
        external: (id) => {
          // Externalize as much as possible to mimic esbuild's bundle: false

          // Node built-ins
          if (id.startsWith('node:')) {
            return true
          }

          // Externalize anything that looks like a bare module specifier
          // (i.e. not a relative or absolute path)
          if (!id.startsWith('.') && !path.isAbsolute(id)) {
            return true
          }

          return false
        },
      },
    },
    // cedarImportDirPlugin must run before the Babel transform so glob imports
    // are expanded before Babel sees the code.  The Babel import-dir plugin is
    // disabled for forVite:true builds; this inline Vite plugin is its
    // replacement for this code path (both CJS and ESM output via Rollup).
    // tsconfigPaths resolves user-defined tsconfig.json `paths` aliases; it
    // replaces the Babel module-resolver's tsconfig-paths handling for this
    // code path.
    plugins: [
      tsconfigPaths(),
      createImportDirVitePlugin(),
      createDirectoryNamedImportVitePlugin(),
      createCedarViteApiPlugin(),
    ],
  })
}

const transpileApi = async (files: string[]) => {
  const result = await build(getEsbuildOptions(files))
  const cedarPaths = getPaths()
  await fixSourceMaps(cedarPaths.api.dist, cedarPaths.api.src)
  return result
}

// esbuild combines Babel's inline source maps with its own, but the resulting
// `sources` paths are often wrong (absolute or relative to the wrong base),
// which breaks debugger breakpoints. This mirrors the known workaround from
// issue #24: recompute the correct relative path from each .js.map file to its
// corresponding .ts source file and overwrite the sources entry.
export async function fixSourceMaps(
  distDir: string,
  srcDir: string,
): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(distDir, {
      recursive: true,
      withFileTypes: true,
    })
  } catch {
    return
  }

  const mapFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.js.map'))
    .map((e) => path.join((e as any).parentPath ?? (e as any).path, e.name))

  await Promise.all(
    mapFiles.map(async (mapFile) => {
      try {
        const raw = await fs.promises.readFile(mapFile, 'utf8')
        const map = JSON.parse(raw)

        if (!Array.isArray(map.sources) || map.sources.length === 0) {
          return
        }

        // Derive the source file path: dist/functions/graphql.js.map → src/functions/graphql.ts
        const jsFile = mapFile.slice(0, -4) // strip '.map'
        const baseName = path.relative(distDir, jsFile).replace(/\.js$/, '')

        const srcFile = ['.ts', '.tsx', '.jsx', '.js']
          .map((ext) => path.join(srcDir, baseName + ext))
          .find((f) => fs.existsSync(f))

        if (!srcFile) {
          return
        }

        const correctRelPath = normalizePath(
          path.relative(path.dirname(mapFile), srcFile),
        )

        if (map.sources[0] === correctRelPath) {
          return // already correct
        }

        map.sources = [correctRelPath]
        await fs.promises.writeFile(mapFile, JSON.stringify(map), 'utf8')
      } catch {
        // skip files that can't be read/parsed
      }
    }),
  )
}

function getEsbuildOptions(files: string[]): BuildOptions {
  const cedarPaths = getPaths()
  const format = projectSideIsEsm('api') ? 'esm' : 'cjs'

  return {
    absWorkingDir: cedarPaths.api.base,
    entryPoints: files,
    platform: 'node',
    target: 'node24',
    format,
    allowOverwrite: true,
    bundle: false,
    // Registration order matters: cedarApiGraphqlPlugin (narrow filter) must
    // come first so it claims graphql.ts before runCedarBabelTransformsPlugin
    // (broad filter) can. See the NOTE on cedarApiGraphqlPlugin.
    plugins: [cedarApiGraphqlPlugin, runCedarBabelTransformsPlugin],
    outdir: cedarPaths.api.dist,
    // setting this to 'true' will generate an external sourcemap x.js.map
    // AND set the sourceMappingURL comment
    // (setting it to 'external' will ONLY generate the file, but won't add the comment)
    sourcemap: true,
  }
}
