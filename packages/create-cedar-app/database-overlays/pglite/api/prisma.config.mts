import net from 'node:net'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { defineConfig, env } from 'prisma/config'

let pglite: PGlite | null = null
let pgliteServer: PGLiteSocketServer | null = null

async function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        // Don't block on unexpected errors
        resolve(false)
      }
    })

    server.once('listening', () => {
      server.close(() => resolve(false))
    })

    server.listen(port, host)
  })
}

async function startPglite(databaseUrl: string | undefined) {
  if (pglite || pgliteServer) {
    return
  }

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set')
    return
  }

  try {
    const url = new URL(databaseUrl)
    const port = parseInt(url.port, 10)

    if (await isPortInUse(port, url.hostname)) {
      // Port is in use, skip PGlite server start as it's most likely already
      // running
      return
    }

    const pgDataDir = path.join(import.meta.dirname, 'db', 'pglite-data')

    pglite = await PGlite.create(pgDataDir)
    pgliteServer = new PGLiteSocketServer({
      db: pglite,
      port,
      host: url.hostname,
    })

    await pgliteServer.start()
  } catch (error) {
    console.error('Failed to start PGlite server:', error)
    pglite = null
    pgliteServer = null
  }
}

const config = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})

await startPglite(config.datasource?.url)

export default config
