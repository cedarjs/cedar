import { findUp } from './findUp.js'

const CONFIG_FILE_NAMES = ['cedar.toml', 'redwood.toml']

const getConfigPathCache = new Map<string, string>()

/**
 * Search the parent directories for the Cedar configuration file.
 */
export const getConfigPath = (
  cwd: string = process.env.RWJS_CWD ?? process.cwd(),
): string => {
  const cachedPath = getConfigPathCache.get(cwd)

  if (cachedPath) {
    return cachedPath
  }

  const configPath = findUp('cedar.toml', cwd) || findUp('redwood.toml', cwd)

  if (!configPath) {
    throw new Error(
      `Could not find a "${CONFIG_FILE_NAMES.join('" or "')}" file, are you ` +
        "sure you're in a Cedar project?",
    )
  }

  getConfigPathCache.set(cwd, configPath)

  return configPath
}
