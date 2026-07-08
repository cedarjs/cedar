import fs from 'node:fs'
import path from 'node:path'

import type { BuildContext, BuildOptions, PluginBuild } from 'esbuild'
import { build, context } from 'esbuild'
import type { Plugin } from 'vite'
import { build as viteBuild, normalizePath } from 'vite'

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import { findApiFiles } from '../files.js'

import { applyContextWrapping } from './esbuild-plugin-cedar-context-wrapping.js'

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
    const cedarConfig = getConfig()
    build.onLoad({ filter: /\.(js|ts|tsx|jsx)$/ }, async (args) => {
      const fileContents = await fs.promises.readFile(args.path, 'utf-8')
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
      if (transformedCode?.code) {
        // Apply the context-wrapping safeguard to API function handlers. This
        // is the standalone-esbuild equivalent of the Vite
        // cedarContextWrappingPlugin and the (Jest-only) babel plugin it
        // replaced.
        const functionsDir = normalizePath(
          path.join(getPaths().api.src, 'functions'),
        )
        const code = normalizePath(args.path).startsWith(functionsDir + '/')
          ? (applyContextWrapping(transformedCode.code, {
              projectIsEsm: projectSideIsEsm('api'),
            }) ?? transformedCode.code)
          : transformedCode.code
        return {
          contents: code,
          loader: 'js',
        }
      }
      throw new Error(`Could not transform file: ${args.path}`)
    })
  },
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

      const transformedCode = await transformWithBabel(
        code,
        id,
        getApiSideBabelPlugins({
          openTelemetry:
            cedarConfig.experimental.opentelemetry.enabled &&
            cedarConfig.experimental.opentelemetry.wrapApi,
          projectIsEsm: isEsm,
        }),
        true,
      )

      if (transformedCode?.code) {
        const functionsDir = normalizePath(
          path.join(cedarPaths.api.src, 'functions'),
        )
        const code = normalizePath(id).startsWith(functionsDir + '/')
          ? (applyContextWrapping(transformedCode.code, {
              projectIsEsm: isEsm,
            }) ?? transformedCode.code)
          : transformedCode.code
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
    plugins: [createCedarViteApiPlugin()],
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
    plugins: [runCedarBabelTransformsPlugin],
    outdir: cedarPaths.api.dist,
    // setting this to 'true' will generate an external sourcemap x.js.map
    // AND set the sourceMappingURL comment
    // (setting it to 'external' will ONLY generate the file, but won't add the comment)
    sourcemap: true,
  }
}
