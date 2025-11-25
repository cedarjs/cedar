import path from 'path'

// See https://github.com/webdiscus/ansis#troubleshooting
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ansis from 'ansis'
import chokidar from 'chokidar'
import { config } from 'dotenv-defaults'

import {
  buildApi,
  cleanApiBuild,
  rebuildApi,
} from '@cedarjs/internal/dist/build/api'
import { loadAndValidateSdls } from '@cedarjs/internal/dist/validateSchema'
import { ensurePosixPath, getPaths } from '@cedarjs/project-config'

import type { BuildAndRestartOptions } from './buildManager.js'
import { BuildManager } from './buildManager.js'
import { serverManager } from './serverManager.js'

const cedarPaths = getPaths()

if (!process.env.REDWOOD_ENV_FILES_LOADED) {
  config({
    path: path.join(cedarPaths.base, '.env'),
    defaults: path.join(cedarPaths.base, '.env.defaults'),
    multiline: true,
  })

  process.env.REDWOOD_ENV_FILES_LOADED = 'true'
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
 */
export async function startWatch() {
  // NOTE: the file with a detected change comes through as a unix path, even on
  // windows. So we need to convert the cedarPaths
  const ignoredApiPaths = [
    // use this, because using cedarPaths.api.dist seems to not ignore on first
    // build
    'api/dist',
    cedarPaths.api.types,
    cedarPaths.api.db,
  ].map((path) => ensurePosixPath(path))
  const ignoredExtensions = [
    '.DS_Store',
    '.db',
    '.sqlite',
    '-journal',
    '.test.js',
    '.test.ts',
    '.scenarios.ts',
    '.scenarios.js',
    '.d.ts',
    '.log',
  ]

  const watcher = chokidar.watch([cedarPaths.api.src], {
    persistent: true,
    ignoreInitial: true,
    ignored: (file: string) => {
      const shouldIgnore =
        file.includes('node_modules') ||
        ignoredApiPaths.some((ignoredPath) => file.includes(ignoredPath)) ||
        ignoredExtensions.some((ext) => file.endsWith(ext))

      return shouldIgnore
    },
  })

  watcher.on('ready', async () => {
    // First time
    await buildManager.run({ clean: true, rebuild: false })
    await validateSdls()
  })

  watcher.on('all', async (eventName, filePath) => {
    // On sufficiently large projects (500+ files, or >= 2000 ms build times) on older machines,
    // esbuild writing to the api directory makes chokidar emit an `addDir` event.
    // This starts an infinite loop where the api starts building itself as soon as it's finished.
    // This could probably be fixed with some sort of build caching
    if (eventName === 'addDir' && filePath === cedarPaths.api.base) {
      return
    }

    if (eventName) {
      if (filePath.includes('.sdl')) {
        // We validate here, so that developers will see the error
        // As they're running the dev server
        const isValid = await validateSdls()

        // Exit early if not valid
        if (!isValid) {
          return
        }
      }
    }

    console.log(
      ansis.dim(`[${eventName}] ${filePath.replace(cedarPaths.api.base, '')}`),
    )

    buildManager.cancelScheduledBuild()

    if (eventName === 'add' || eventName === 'unlink') {
      await buildManager.run({ rebuild: false })
    } else {
      // If files have just changed, then rebuild
      await buildManager.run({ rebuild: true })
    }
  })
}

// For ESM we'll wrap this in a check to only execute this function if
// the file is run as a script using
// `import.meta.url === `file://${process.argv[1]}``
startWatch()
