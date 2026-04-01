import fs from 'node:fs'
import path from 'node:path'

import { getConfigPath } from './configPath.js'

/**
 * Based on the location of the project config file (e.g. cedar.toml), it checks
 * for the existence of `.cedar/` or `.redwood/` directories. If either is found,
 * it returns the path to that directory.
 *
 * If neither directory exists yet it default to `.cedar/` in the resolved
 * project root.
 */
export function getGeneratedDataDirPath(
  cwd: string = process.env.CEDAR_CWD ?? process.env.RWJS_CWD ?? process.cwd(),
) {
  const configPath = getConfigPath(cwd)
  const projectRoot = path.dirname(configPath)
  const rootDotCedarDir = path.join(projectRoot, '.cedar')
  const rootDotRedwoodDir = path.join(projectRoot, '.redwood')

  const generatedDirPath = fs.existsSync(rootDotCedarDir)
    ? rootDotCedarDir
    : fs.existsSync(rootDotRedwoodDir)
      ? rootDotRedwoodDir
      : rootDotCedarDir

  return generatedDirPath
}
