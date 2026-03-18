import { argv } from 'node:process'

import { getConfig } from '@cedarjs/project-config'

const defaultApiDebugPort = 18911

export function getApiDebugFlag(apiDebugPort?: number) {
  // Passed in flag takes precedence
  if (apiDebugPort) {
    return `--debug-port ${apiDebugPort}`
  } else if (argv.includes('--apiDebugPort')) {
    return `--debug-port ${defaultApiDebugPort}`
  }

  const apiDebugPortInConfig = getConfig().api.debugPort
  if (apiDebugPortInConfig) {
    return `--debug-port ${apiDebugPortInConfig}`
  }

  // Don't pass in debug port flag, unless configured
  return ''
}
