import fs from 'node:fs'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

import { getPaths } from '@cedarjs/project-config'

let pglite: PGlite | null = null
let pgliteServer: PGLiteSocketServer | null = null

export function isPgliteProject(): boolean {
  try {
    const cedarPaths = getPaths()
    const pgliteDataDir = path.join(cedarPaths.api.base, 'db', 'pglite-data')
    return fs.existsSync(pgliteDataDir)
  } catch {
    return false
  }
}

function parseDatabaseUrl(): { host: string; port: number } {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL environment variable is required for PGlite. Please set it in your .env file.',
    )
  }

  try {
    const url = new URL(databaseUrl)
    return {
      host: url.hostname || '127.0.0.1',
      port: parseInt(url.port, 10) || 5433,
    }
  } catch {
    throw new Error(
      `Invalid DATABASE_URL: ${databaseUrl}. Please use a valid PostgreSQL connection string.`,
    )
  }
}

export async function startPglite(): Promise<boolean> {
  if (pglite || pgliteServer) {
    return true
  }

  if (!isPgliteProject()) {
    return false
  }

  try {
    const cedarPaths = getPaths()
    const pgDataDir = path.join(cedarPaths.api.base, 'db', 'pglite-data')
    const { host, port } = parseDatabaseUrl()

    pglite = await PGlite.create(pgDataDir)
    pgliteServer = new PGLiteSocketServer({
      db: pglite,
      port,
      host,
    })
    await pgliteServer.start()

    return true
  } catch (error) {
    console.error('Failed to start PGlite server:', error)
    pglite = null
    pgliteServer = null
    return false
  }
}

export async function stopPglite(): Promise<void> {
  if (pgliteServer) {
    await pgliteServer.stop()
    pgliteServer = null
  }
  if (pglite) {
    await pglite.close()
    pglite = null
  }
}
