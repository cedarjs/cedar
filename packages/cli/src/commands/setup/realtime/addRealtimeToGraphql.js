import fs from 'node:fs'
import path from 'node:path'

import { isTypeScriptProject } from '@cedarjs/cli-helpers'
import { getPaths } from '@cedarjs/project-config'

export function addRealtimeToGraphqlHandler(ctx, task, force) {
  const graphqlHandlerPath = path.join(
    getPaths().api.functions,
    `graphql.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  if (!fs.existsSync(graphqlHandlerPath)) {
    ctx.realtimeHandlerSkipped = true
    task.skip('GraphQL handler not found')
    return
  }

  const contentLines = fs
    .readFileSync(graphqlHandlerPath)
    .toString()
    .split('\n')

  const importLineRegex =
    /^import {.*realtime.*} from ['"]src\/lib\/realtime['"];?$/
  const multilineImportRegex = /^} from ['"]src\/lib\/realtime['"];?$/

  const hasRealtimeImport = contentLines.some((line) => {
    return importLineRegex.test(line) || multilineImportRegex.test(line)
  })

  if (hasRealtimeImport && !force) {
    ctx.realtimeHandlerSkipped = true
    task.skip('Realtime import already exists')
    return
  }

  const handlerIndex = contentLines.findLastIndex(
    (line) => line === 'export const handler = createGraphQLHandler({',
  )

  if (handlerIndex === -1) {
    ctx.realtimeHandlerSkipped = true
    task.skip('Unexpected syntax. Handler not found')
    return
  }

  // handlerLines is everything from
  // `export const handler = createGraphQLHandler({`
  // to the end of the file
  const handlerLines = contentLines.slice(handlerIndex)

  const hasRealtimeOption = handlerLines.some((line) =>
    /^\s*realtime\b/.test(line),
  )

  if (hasRealtimeOption && !force) {
    ctx.realtimeHandlerSkipped = true
    task.skip('Realtime option already exists')
    return
  }

  const lastImportIndex = contentLines
    .slice(0, handlerIndex)
    .findLastIndex((line) => line.startsWith('import '))

  if (lastImportIndex === -1) {
    ctx.realtimeHandlerSkipped = true
    task.skip('Unexpected syntax. No imports found')
    return
  }

  contentLines.splice(
    lastImportIndex + 1,
    0,
    "import { realtime } from 'src/lib/realtime'",
  )
  const handlerIndexAfterSplice = handlerIndex + 1

  const sdlsIndex = handlerLines.findLastIndex((line) =>
    /^\s*sdls,$/.test(line),
  )

  if (sdlsIndex === -1) {
    ctx.realtimeHandlerSkipped = true
    task.skip('Unexpected syntax. `sdls` option not found')
    return
  }

  // insert `realtime,` right before `sdls,`
  contentLines.splice(handlerIndexAfterSplice + sdlsIndex, 0, '  realtime,')

  fs.writeFileSync(graphqlHandlerPath, contentLines.join('\n'))
}
