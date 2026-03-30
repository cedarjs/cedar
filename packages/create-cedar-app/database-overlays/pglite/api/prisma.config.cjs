const path = require('node:path')

const { PGlite } = require('@electric-sql/pglite')
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket')
const { defineConfig, env } = require('prisma/config')

let pglite = null
let pgliteServer = null

async function startPglite(databaseUrl) {
  if (pglite || pgliteServer) {
    return
  }

  if (!databaseUrl) {
    console.warn('DATABASE_URL environment variable is not set')
    return
  }

  try {
    const url = new URL(databaseUrl)
    const pgDataDir = path.join(__dirname, 'db', 'pglite-data')

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

startPglite(config.datasource.url)

module.exports = config
