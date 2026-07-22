import fs from 'node:fs'
import path from 'node:path'

import type { BuildContext, BuildOptions, PluginBuild } from 'esbuild'
import { build, context } from 'esbuild'
import MagicString from 'magic-string'
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
  getApiSideBabelConfigPath,
  getApiSideBabelPluginsForVite,
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
import { applyEsmExtensions } from './esm-extensions.js'
import { applyImportDir } from './import-dir.js'
import { applyJobPathInjector } from './job-path-injector.js'
import { applySrcAlias } from './src-alias.js'
import { applyTsconfigPaths } from './tsconfig-paths.js'

export { applySrcAlias } from './src-alias.js'
export { applyEsmExtensions } from './esm-extensions.js'

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
      // before Babel runs.  The Babel import-dir plugin is not part of
      // getApiSideBabelPluginsForVite(); applyImportDir is the esbuild
      // equivalent.
      //
      // This is intentionally applied inline rather than as a separate esbuild
      // plugin because esbuild 0.27 lacks onTransform chaining — onLoad
      // handlers are exclusive (first match wins), so a standalone pre-plugin
      // would claim the file and prevent this plugin's Babel transform from
      // running on the same file.
      fileContents =
        applyImportDir(fileContents, args.path)?.code ?? fileContents
      // Inject `path` and `name` into createJob() definitions. This replaces
      // the Babel job path injector override, which is disabled now that this
      // pipeline calls transformWithBabel with forVite: true. It is the
      // esbuild equivalent of the cedarjsJobPathInjectorPlugin used by the
      // @cedarjs/vite pipelines.
      fileContents =
        applyJobPathInjector(fileContents, args.path, getPaths().api.jobs) ??
        fileContents

      const normalizedPath = normalizePath(args.path)
      const cedarPaths = getPaths()
      const isEsm = projectSideIsEsm('api')

      // The Babel pass is only needed to apply a user's custom
      // api/babel.config.js: getApiSideBabelPluginsForVite() is empty (the
      // transforms above replace Cedar's api-side Babel plugins) and esbuild
      // strips TypeScript itself when given the matching loader.
      const apiBabelConfigPath = getApiSideBabelConfigPath()

      let code = fileContents

      if (apiBabelConfigPath) {
        const transformedCode = await transformWithBabel(
          fileContents,
          args.path,
          getApiSideBabelPluginsForVite(),
          'inline',
          true,
        )

        if (!transformedCode?.code) {
          throw new Error(`Could not transform file: ${args.path}`)
        }

        code = transformedCode.code
      }

      // For ESM projects, append .js/.jsx to extensionless relative imports
      // so Node's ESM resolver can locate the compiled output files at
      // runtime.  This replaces the resolvePath hook that
      // babel-plugin-module-resolver previously provided; that plugin is not
      // part of getApiSideBabelPluginsForVite().
      if (isEsm) {
        code = applyEsmExtensions(code, args.path)
      }

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

      if (normalizedPath.startsWith(normalizePath(cedarPaths.api.src) + '/')) {
        code = applyOtelWrapping(code, args.path, cedarPaths.api.src) ?? code
      }

      return {
        contents: code,
        // Babel output is always plain JS. Without Babel the contents are
        // still TypeScript/JSX, so pick the loader matching the file's
        // extension and let esbuild do the stripping.
        loader: apiBabelConfigPath ? 'js' : getEsbuildLoader(args.path),
      }
    })
  },
}

/**
 * Maps a source file's extension to the esbuild loader that can parse it.
 * Used when the Babel pass is skipped and esbuild receives untranspiled
 * TypeScript/JSX contents from an onLoad hook.
 */
function getEsbuildLoader(filePath: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  switch (path.extname(filePath)) {
    case '.ts':
      return 'ts'
    case '.tsx':
      return 'tsx'
    case '.jsx':
      return 'jsx'
    default:
      return 'js'
  }
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
      // Inject `path` and `name` into createJob() definitions. This replaces
      // the Babel job path injector override, which is disabled now that this
      // pipeline calls transformWithBabel with forVite: true. It is the
      // standalone-Vite equivalent of the cedarjsJobPathInjectorPlugin used
      // by the @cedarjs/vite pipelines.
      sourceCode =
        applyJobPathInjector(sourceCode, id, cedarPaths.api.jobs) ?? sourceCode

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

      // The Babel pass is only needed to apply a user's custom
      // api/babel.config.js: getApiSideBabelPluginsForVite() is empty (the
      // transforms in this pipeline replace Cedar's api-side Babel plugins)
      // and Vite strips TypeScript itself.
      const apiBabelConfigPath = getApiSideBabelConfigPath()

      const transformedCode = apiBabelConfigPath
        ? await transformWithBabel(
            sourceCode,
            id,
            getApiSideBabelPluginsForVite(),
            true,
            true,
          )
        : null

      if (apiBabelConfigPath && !transformedCode?.code) {
        throw new Error(`Could not transform file: ${id}`)
      }

      let outputCode = transformedCode?.code ?? sourceCode

      // Apply OTel wrapping to all API files.
      if (
        cedarConfig.experimental?.opentelemetry?.enabled &&
        cedarConfig.experimental?.opentelemetry?.wrapApi
      ) {
        outputCode =
          applyOtelWrapping(outputCode, id, cedarPaths.api.src) ?? outputCode
      }

      // Append .js/.jsx extensions to extensionless relative imports so that
      // Node's ESM resolver can find them at runtime. This replaces the
      // resolvePath hook in babel-plugin-module-resolver, which is not part
      // of getApiSideBabelPluginsForVite() (babel-config/src/api.ts). With
      // preserveModules:true Rollup preserves the import specifiers as-is
      // in the output, so extensions must be present before bundling.
      if (isEsm) {
        outputCode = applyEsmExtensions(outputCode, id)
      }

      // Apply the handler ALS wrapping safeguard to API function handlers.
      // This is the standalone-esbuild equivalent of the Vite
      // handlerAlsWrappingPlugin and the (Jest-only) babel plugin it
      // replaced.
      const functionsDir = normalizePath(cedarPaths.api.functions)
      if (normalizedId.startsWith(functionsDir + '/')) {
        outputCode =
          applyHandlerAlsWrapping(outputCode, {
            projectIsEsm: isEsm,
          }) ?? outputCode
      }

      if (!transformedCode) {
        // Without Babel there's no transform to report when the string
        // rewrites didn't change anything.
        if (outputCode === code) {
          return null
        }

        // No Babel map to chain; a high-resolution identity map over the
        // input keeps the sourcemap chain intact. This matches the fidelity
        // of the Babel path, whose map also predates the post-Babel string
        // transforms.
        return {
          code: outputCode,
          map: new MagicString(code).generateMap({ hires: true }),
        }
      }

      return {
        code: outputCode,
        map: transformedCode.map ?? null,
      }
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
    // not part of getApiSideBabelPluginsForVite(); this inline Vite plugin is
    // its replacement for this code path (both CJS and ESM output via Rollup).
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
