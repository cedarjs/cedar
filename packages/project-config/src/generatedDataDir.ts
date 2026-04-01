import path from 'node:path'

import { getConfigPath } from './configPath.js'
import { findUp } from './findUp.js'

/**
 * Search the parent directories for the directory Cedar stores generated and
 * other transatory data in.
 *
 * If neither `.cedar` nor `.redwood` exists yet it default to `.cedar` in the
 * resolved project root.
 */
export function getGeneratedDataDirPath(
  cwd: string = process.env.CEDAR_CWD ?? process.env.RWJS_CWD ?? process.cwd(),
) {
  const configPath = getConfigPath(cwd)
  const projectRoot = path.dirname(configPath)

  const generatedDirPath =
    findUp('.cedar', cwd) ||
    findUp('.redwood', cwd) ||
    path.join(projectRoot, '.cedar')

  return generatedDirPath
}
