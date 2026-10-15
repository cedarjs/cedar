import fs from 'node:fs'
import path from 'node:path'

import { getGeneratedDataDirPath } from './generatedDataDir.js'

/**
 * Directory, in the generated data directory (`.cedar/`), where running
 * processes record information about themselves, one file per kind of
 * process. Deploys read it on the server to find out how the processes were
 * started, which `--apiPort`, `CEDAR_API_PORT` or `PORT` can decide there
 */
export const PROCESS_META_DIR_NAME = 'process-meta'

/** File in the process meta directory that the api server writes */
export const API_PROCESS_META_FILE_NAME = 'api.json'

/** What a running api server records about itself */
export interface ApiProcessMeta {
  /** Version of this file's format */
  version: 1
  /** Port the api server listens on */
  port: number
  /** Address the api server listens on, like `::` or `127.0.0.1` */
  host: string
  /**
   * Path the api functions and GraphQL are served under, like `/` or `/api/`.
   * Left out by the Universal Deploy server, whose root path is set when it's
   * built
   */
  rootPath?: string
  /** Id of the process */
  pid: number
  /** When the process started, as an ISO 8601 timestamp */
  startedAt: string
}

/**
 * Writes what the running api server records about itself to
 * `process-meta/api.json` in the project's generated data directory. The file
 * is written to a temporary name and then renamed, so a reader never sees it
 * half written
 */
export function writeApiProcessMeta({
  port,
  host,
  rootPath,
}: Pick<ApiProcessMeta, 'port' | 'host' | 'rootPath'>) {
  const processMetaDir = path.join(
    getGeneratedDataDirPath(),
    PROCESS_META_DIR_NAME,
  )
  const metaPath = path.join(processMetaDir, API_PROCESS_META_FILE_NAME)
  const tmpPath = `${metaPath}.${process.pid}.tmp`

  const meta: ApiProcessMeta = {
    version: 1,
    port,
    host,
    ...(rootPath !== undefined ? { rootPath } : {}),
    pid: process.pid,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  }

  fs.mkdirSync(processMetaDir, { recursive: true })
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2) + '\n')
  fs.renameSync(tmpPath, metaPath)
}
