import fs from 'node:fs'
import path from 'node:path'

import type { PluginBuild } from 'esbuild'
import { build as esbuildBuild } from 'esbuild'
import { gqlPlugin } from 'vite-plugin-graphql-tag'

import {
  getRouteHookBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { findRouteHooksSrc } from '@cedarjs/internal/dist/files.js'
import type { Paths } from '@cedarjs/project-config'
import { getPaths } from '@cedarjs/project-config'

const GQL_TAG_PLUGIN_NAME = 'rwjs-babel-graphql-tag'

// gqlPlugin() returns Vite's PluginOption union (broad, includes false/
// Promise/array). Narrow via control-flow elimination
const gqlPluginResult = gqlPlugin()
if (
  !gqlPluginResult ||
  Array.isArray(gqlPluginResult) ||
  !('transform' in gqlPluginResult) ||
  !gqlPluginResult.transform
) {
  throw new Error('vite-plugin-graphql-tag did not return the expected shape')
}

// gqlPluginResult.transform is ObjectHook<TransformHook> — Vite 7's union of
// the raw function form and the object form { handler, filter?, order? }.
// gqlPlugin() always returns the object form, so narrow to it via typeof.
const transform = gqlPluginResult.transform
if (typeof transform !== 'object' || !('handler' in transform)) {
  throw new Error('vite-plugin-graphql-tag did not return the expected shape')
}

const gqlTransform = transform.handler

export async function buildRouteHooks(
  verbose: boolean | undefined,
  rwPaths: Paths,
) {
  const allRouteHooks = findRouteHooksSrc()

  const runRwBabelTransformsPlugin = {
    name: 'cedar-esbuild-babel-transform',
    setup(build: PluginBuild) {
      build.onLoad({ filter: /\.(js|ts|tsx|jsx)$/ }, async (args) => {
        const fileContents = await fs.promises.readFile(args.path, 'utf-8')

        // Start with all route-hook plugins but exclude
        // babel-plugin-graphql-tag — we handle gql compilation via
        // vite-plugin-graphql-tag's transform below.
        const babelPlugins = getRouteHookBabelPlugins().filter(
          (p) => !(Array.isArray(p) && p[2] === GQL_TAG_PLUGIN_NAME),
        )

        const transformedCode = await transformWithBabel(
          fileContents,
          args.path,
          babelPlugins,
        )

        if (transformedCode?.code) {
          // Apply gql template compilation using vite-plugin-graphql-tag's
          // transform with a minimal Vite context mock. The plugin only uses
          // warn()/error() from the context. A full TransformPluginContext
          // mock (30+ Rollup methods) is impractical here.
          // We do this so we can use a vite plugin from esbuild. That's why the
          // types are hacky here
          const mockCtx = {
            warn(msg: unknown) {
              console.warn(`[gql-plugin] ${msg}`)
            },
            error(err: unknown): never {
              throw new Error(String(err))
            },
          } as any

          const gqlResult = await gqlTransform.call(
            mockCtx,
            transformedCode.code,
            args.path,
          )

          const gqlCode =
            gqlResult && typeof gqlResult === 'object' && 'code' in gqlResult
              ? (gqlResult as { code: string }).code
              : undefined

          return {
            contents: gqlCode ?? transformedCode.code,
            loader: 'js',
          }
        }

        throw new Error(`Could not transform file: ${args.path}`)
      })
    },
  }

  await esbuildBuild({
    absWorkingDir: getPaths().web.base,
    entryPoints: allRouteHooks,
    platform: 'node',
    target: 'node16',
    // @MARK Disable splitting and esm, because Redwood web modules don't support esm yet
    // outExtension: { '.js': '.mjs' },
    // format: 'esm',
    // splitting: true,
    bundle: true,
    plugins: [runRwBabelTransformsPlugin],
    packages: 'external',
    logLevel: verbose ? 'info' : 'error',
    outdir: rwPaths.web.distRouteHooks,
    alias: {
      'api/src': path.join(getPaths().api.base, 'src'),
    },
  })
}
