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

// Create the vite-plugin-graphql-tag instance once and extract its transform
// handler. We'll call it from esbuild's onLoad with a mock Vite context.
const gqlTransform = gqlPlugin().transform.handler

export async function buildRouteHooks(
  verbose: boolean | undefined,
  rwPaths: Paths,
) {
  const allRouteHooks = findRouteHooksSrc()

  const runRwBabelTransformsPlugin = {
    name: 'rw-esbuild-babel-transform',
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
          // transform with a minimal Vite context mock.
          const gqlResult = gqlTransform.call(
            {
              warn(msg: string) {
                console.warn(`[gql-plugin] ${msg}`)
              },
              error(msg: string) {
                throw new Error(msg)
              },
            },
            transformedCode.code,
            args.path,
          )

          return {
            contents:
              (gqlResult as { code: string })?.code ?? transformedCode.code,
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
