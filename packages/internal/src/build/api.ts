import fs from 'node:fs'
import path from 'node:path'

import type { BuildContext, BuildOptions, PluginBuild } from 'esbuild'
import { build, context } from 'esbuild'
import type { Plugin } from 'vite'
import { build as viteBuild } from 'vite'

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import { findApiFiles } from '../files.js'

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
  return BUILD_CTX.rebuild()
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
      const transformedCode = await transformWithBabel(
        args.path,
        getApiSideBabelPlugins({
          openTelemetry:
            cedarConfig.experimental.opentelemetry.enabled &&
            cedarConfig.experimental.opentelemetry.wrapApi,
          projectIsEsm: projectSideIsEsm('api'),
        }),
      )
      if (transformedCode?.code) {
        return {
          contents: transformedCode.code,
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
    async transform(_code, id) {
      if (!/\.(js|ts|tsx|jsx)$/.test(id)) {
        return null
      }

      const transformedCode = await transformWithBabel(
        id,
        getApiSideBabelPlugins({
          openTelemetry:
            cedarConfig.experimental.opentelemetry.enabled &&
            cedarConfig.experimental.opentelemetry.wrapApi,
          projectIsEsm: isEsm,
        }),
      )

      if (transformedCode?.code) {
        return {
          code: transformedCode.code,
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
      .replace(/\.(ts|tsx|jsx)$/, '')
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
        },
        external: (id) => {
          // Externalize all node_modules (same as esbuild's bundle: false)
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

export const transpileApi = async (files: string[]) => {
  return build(getEsbuildOptions(files))
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
    sourcemap: true,
  }
}
