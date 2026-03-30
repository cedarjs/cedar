import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { defineConfig, env } from 'prisma/config'

let pglite: PGlite | null = null
let pgliteServer: PGLiteSocketServer | null = null

async function startPglite(databaseUrl: string | undefined) {
  if (pglite || pgliteServer) {
    return
  }

  if (!databaseUrl) {
    console.warn('DATABASE_URL environment variable is not set')
    return
  }

  try {
    const url = new URL(databaseUrl)
    const pgDataDir = path.join(import.meta.dirname, 'db', 'pglite-data')

    pglite = await PGlite.create(pgDataDir)
    pgliteServer = new PGLiteSocketServer({
      db: pglite,
      port: parseInt(url.port, 10),
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
