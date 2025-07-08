import path from 'node:path'

import { createServer, version as viteVersion } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'
import { installSourcemapsSupport } from 'vite-node/source-map'

import { getPaths } from '@cedarjs/project-config'

export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}) {
  console.log(
    'execWithViteNode.js runScriptFunction',
    scriptPath,
    functionName,
    args,
  )
  const relativePath = path.relative(getPaths().scripts, scriptPath)
  console.log(
    'execWithViteNode.js runScriptFunction relativePath',
    relativePath,
  )
  // create vite server
  const server = await createServer({
    optimizeDeps: {
      // This is recommended in the vite-node readme
      disabled: true,
    },
  })

  // For old Vite, this is needed to initialize the plugins.
  if (Number(viteVersion.split('.')[0]) < 6) {
    await server.pluginContainer.buildStart({})
  }

  const node = new ViteNodeServer(server, {
    deps: {
      fallbackCJS: true,
    },
  })

  // fixes stacktraces in Errors
  installSourcemapsSupport({
    getSourceMap: (source) => node.getSourceMap(source),
  })

  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule(id) {
      return node.fetchModule(id)
    },
    resolveId(id, importer) {
      return node.resolveId(id, importer)
    },
  })

  const imp = await runner.interopedImport(scriptPath)
  console.log('imp', imp)
  const returnValue = '5'

  // execute the file
  // await runner.executeFile('./example.ts')

  // close the vite server
  await server.close()

  try {
    // TODO: Enable this again
    // const { db } = createdRequire(path.join(getPaths().api.lib, 'db'))
    // db.$disconnect()
  } catch (e) {
    // silence
  }

  return returnValue
}
