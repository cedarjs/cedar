import { argv } from 'node:process'

import { getConfig } from '@cedarjs/project-config'

export function getApiDebugFlag(
  apiDebugPort: number | undefined,
  apiAvailablePort: number,
) {
  // Passed in flag takes precedence
  if (apiDebugPort) {
    return `--debug-port ${apiDebugPort}`
  } else if (argv.includes('--apiDebugPort')) {
    // Flag used with no value, so we derive the port from api port to avoid
    // collisions when running multiple apps simultaneously
    return `--debug-port ${'1' + apiAvailablePort}`
  }

  // No flag – read from config

  const apiDebugPortInConfig = getConfig().api.debugPort

  if (apiDebugPortInConfig) {
    return `--debug-port ${apiDebugPortInConfig}`
  } else if (apiDebugPortInConfig === false) {
    // Explicitly disabled in config
    return ''
  }

  // Default: derive debug port from api port (e.g. 8911 -> 18911, 8913 ->
  // 18913)
  // This ensures multiple apps running on different ports don't share the
  // same debug port.
  return `--debug-port ${'1' + apiAvailablePort}`
}
