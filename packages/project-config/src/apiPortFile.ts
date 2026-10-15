import fs from 'node:fs'
import path from 'node:path'

import { getGeneratedDataDirPath } from './generatedDataDir.js'

/**
 * Name of the file, in the generated data directory (`.cedar/`), that a
 * running api server writes the port it listens on to. Deploys read it to
 * find the api on the server, where the port can come from `--apiPort`,
 * `CEDAR_API_PORT` or `PORT` rather than cedar.toml
 */
export const API_PORT_FILE_NAME = 'api-port'

/**
 * Writes `port` to the api port file in the project's generated data
 * directory, creating the directory if needed
 */
export function writeApiPortFile(port: number) {
  const generatedDataDir = getGeneratedDataDirPath()

  fs.mkdirSync(generatedDataDir, { recursive: true })
  fs.writeFileSync(path.join(generatedDataDir, API_PORT_FILE_NAME), `${port}\n`)
}
