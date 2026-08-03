import path from 'node:path'

import ansis from 'ansis'
import chokidar from 'chokidar'
import { config } from 'dotenv-defaults'

// `@cedarjs/internal` is an optional peer dependency, not a regular one, so
// that it stays out of production installs — it pulls in Babel and the whole
// graphql-codegen suite. This watcher is the only thing in this package that
// needs it, and it only ever runs under `cedar dev`, where `@cedarjs/cli`
// provides it. Keep it that way: nothing reachable from `bin.ts` may import
// `@cedarjs/internal`.
import {
  buildApi,
  cleanApiBuild,
  rebuildApi,
} from '@cedarjs/internal/dist/build/api'
import { loadAndValidateSdls } from '@cedarjs/internal/dist/validateSchema'
import { getPaths } from '@cedarjs/project-config'

import type { BuildAndRestartOptions } from './buildManager.js'
import { BuildManager } from './buildManager.js'
import { serverManager } from './serverManager.js'
import { getIgnoreFunction, pathsToWatch } from './watchPaths.js'

const cedarPaths = getPaths()

if (!process.env.CEDAR_ENV_FILES_LOADED) {
  config({
    path: path.join(cedarPaths.base, '.env'),
    defaults: path.join(cedarPaths.base, '.env.defaults'),
    multiline: true,
  })

  process.env.CEDAR_ENV_FILES_LOADED = 'true'
}

async function buildAndServe(options: BuildAndRestartOptions) {
  const buildTs = Date.now()
  console.log(ansis.dim.italic('Building...'))

  if (options.clean) {
    await cleanApiBuild()
  }

  if (options.rebuild) {
    await rebuildApi()
  } else {
    await buildApi()
  }

  await serverManager.restartApiServer()

  console.log(ansis.dim.italic('Took ' + (Date.now() - buildTs) + ' ms'))
}

const buildManager = new BuildManager(buildAndServe)

async function validateSdls() {
  try {
    await loadAndValidateSdls()
    return true
  } catch (e: any) {
    serverManager.killApiServer()
    console.error(
      ansis.redBright(`[GQL Server Error] - Schema validation failed`),
    )
    console.error(ansis.red(e?.message))
    console.error(ansis.redBright('-'.repeat(40)))

    buildManager.cancelScheduledBuild()
    return false
  }
}

/**
 * Initialize the file watcher for the API server
 * Watches for changes in the API source directory and rebuilds/restarts as
 * needed
 *
 * Also watches package sources so that changes to workspace packages used by
 * the API trigger a rebuild/restart (HMR for API-side workspace packages).
 */
export async function startWatch() {
  const patterns = await pathsToWatch()

  const watcher = chokidar.watch(patterns, {
    persistent: true,
    ignoreInitial: true,
    ignored: await getIgnoreFunction(),
  })

  // This can fire multiple times
  // https://github.com/paulmillr/chokidar/issues/286
  // https://github.com/paulmillr/chokidar/issues/338
  watcher.on('ready', async () => {
    // First time
    await buildManager.run({ clean: true, rebuild: false })
    await validateSdls()
  })

  watcher.on('all', async (eventName, filePath) => {
    // On sufficiently large projects (500+ files, or >= 2000 ms build times) on
    // older machines, esbuild writing to the api directory makes chokidar emit
    // an `addDir` event. This starts an infinite loop where the api starts
    // building itself as soon as it's finished. This could probably be fixed
    // with some sort of build caching
    if (eventName === 'addDir' && filePath === cedarPaths.api.base) {
      return
    }

    if (eventName) {
      if (filePath.includes('.sdl')) {
        // We validate here, so that developers will see the error as they're
        // running the dev server
        const isValid = await validateSdls()

        // Exit early if not valid
        if (!isValid) {
          return
        }
      }
    }

    // Normalize the displayed path so it's relative to the project base.
    const displayPath = path.relative(cedarPaths.base, filePath)
    console.log(ansis.dim(`[${eventName}] ${displayPath}`))

    buildManager.cancelScheduledBuild()

    if (eventName === 'add' || eventName === 'unlink') {
      await buildManager.run({ rebuild: false })
    } else {
      // If files have just changed, then rebuild
      await buildManager.run({ rebuild: true })
    }
  })
}

// For ESM we'll wrap this in a check to only execute this function if the file
// is run as a script using
// `import.meta.url === `file://${process.argv[1]}``
startWatch()
