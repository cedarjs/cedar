#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ansis from 'ansis'
import chokidar from 'chokidar'

import { getPaths } from '@cedarjs/project-config'

import { cliLogger } from '../cliLogger.js'
import {
  isCellFile,
  isPageFile,
  isDirectoryNamedModuleFile,
  isGraphQLSchemaFile,
} from '../files.js'
import { warningForDuplicateRoutes } from '../routes.js'

import { generateClientPreset } from './clientPreset.js'
import { generate } from './generate.js'
import {
  generateTypeDefGraphQLApi,
  generateTypeDefGraphQLWeb,
} from './graphqlCodeGen.js'
import { generateGraphQLSchema } from './graphqlSchema.js'
import {
  generateMirrorCell,
  generateMirrorDirectoryNamedModule,
  generateTypeDefRouterRoutes,
  generateTypeDefRouterPages,
  mirrorPathForDirectoryNamedModules,
  mirrorPathForCell,
} from './typeDefinitions.js'

const rwjsPaths = getPaths()

const watcher = chokidar.watch('(web|api)/src/**/*.{ts,js,jsx,tsx}', {
  persistent: true,
  ignored: ['node_modules', '.redwood'],
  ignoreInitial: true,
  cwd: rwjsPaths.base,
  awaitWriteFinish: true,
})

const action = {
  add: 'Created',
  unlink: 'Deleted',
  change: 'Modified',
}

let routesWarningMessage = ''

process.stdin.on('data', async (data) => {
  const str = data.toString().trim().toLowerCase()
  if (str === 'g' || str === 'rs') {
    cliLogger('Re-creating TypeScript definitions and GraphQL schemas')
    await generate()
  }
})

watcher
  .on('ready', async () => {
    const start = Date.now()
    cliLogger('Generating full TypeScript definitions and GraphQL schemas')
    const { files, errors } = await generate()
    cliLogger(`Done.`)
    cliLogger.debug(`\nCreated ${files.length} in ${Date.now() - start} ms`)

    if (errors.length > 0) {
      for (const { message, error } of errors) {
        console.error(message)
        console.error(error)
        console.log()
      }
    }

    routesWarningMessage = warningForDuplicateRoutes()

    if (routesWarningMessage) {
      console.warn(routesWarningMessage)
    }
  })
  .on('all', async (eventName, p) => {
    cliLogger.trace(
      `File system change: ${ansis.magenta(eventName)} ${ansis.dim(p)}`,
    )
    if (!['add', 'change', 'unlink'].includes(eventName)) {
      return
    }
    const eventTigger = eventName as 'add' | 'change' | 'unlink'
    const absPath = path.join(rwjsPaths.base, p)

    // Track the time in debug
    const start = Date.now()
    const finished = (type: string) =>
      cliLogger.debug(
        action[eventTigger],
        type + ':',
        ansis.dim(p),
        ansis.dim.italic(Date.now() - start + ' ms'),
      )

    if (absPath.includes('Cell') && isCellFile(absPath)) {
      await generateTypeDefGraphQLWeb()
      await generateClientPreset()
      if (eventName === 'unlink') {
        fs.unlinkSync(mirrorPathForCell(absPath, rwjsPaths)[0])
      } else {
        generateMirrorCell(absPath, rwjsPaths)
      }
      finished('Cell')
    } else if (absPath === rwjsPaths.web.routes) {
      generateTypeDefRouterRoutes()
      routesWarningMessage = warningForDuplicateRoutes()
      finished('Routes')
    } else if (absPath.includes('Page') && isPageFile(absPath)) {
      generateTypeDefRouterPages()
      finished('Page')
    } else if (isDirectoryNamedModuleFile(absPath)) {
      if (eventName === 'unlink') {
        fs.unlinkSync(mirrorPathForDirectoryNamedModules(absPath, rwjsPaths)[0])
      } else {
        generateMirrorDirectoryNamedModule(absPath, rwjsPaths)
      }
      finished('Directory named module')
    } else if (isGraphQLSchemaFile(absPath)) {
      await generateGraphQLSchema()
      await generateTypeDefGraphQLApi()
      finished('GraphQL Schema')
    }

    if (routesWarningMessage) {
      console.warn(routesWarningMessage)
    }
  })
