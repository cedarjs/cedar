import os from 'node:os'

import ci from 'ci-info'

import type { TelemetryEnvironment } from './payload.js'
import {
  getNodeInfo,
  getNpmInfo,
  getOsName,
  getShellInfo,
  getVSCodeInfo,
  getYarnInfo,
} from './systemInfo.js'

export async function getTelemetryEnvironment(): Promise<TelemetryEnvironment> {
  // Everything in here is optional, so a failure just leaves that field empty
  const [osName, shell, node, yarn, npm, vscode] = await Promise.all([
    getOsName().catch(() => undefined),
    getShellInfo().catch(() => undefined),
    getNodeInfo().catch(() => undefined),
    getYarnInfo().catch(() => undefined),
    getNpmInfo().catch(() => undefined),
    getVSCodeInfo().catch(() => undefined),
  ])

  const [osType, osVersion] = osName?.split(' ') ?? []

  return {
    osType,
    osVersion,
    // Only the name of the shell, never the path to it
    shell: shell?.path?.split(/[\\/]/).pop(),
    nodeVersion: node?.version,
    yarnVersion: yarn?.version,
    npmVersion: npm?.version,
    vscodeVersion: vscode?.version,
    cpuCount: os.availableParallelism(),
    memoryGb: Math.round(os.totalmem() / 1073741824),
    nodeEnv: describeNodeEnv(process.env.NODE_ENV),
    ci: ci.isCI,
    cedarCi: !!process.env.CEDAR_CI,
    devEnvironment: Object.keys(process.env).some((key) =>
      key.startsWith('GITPOD_'),
    )
      ? 'gitpod'
      : undefined,
  }
}

const KNOWN_NODE_ENVS = new Set(['development', 'production', 'test'])

/**
 * `NODE_ENV` can be set to anything, like the name of a project's staging
 * environment, so only the common values are sent as they are
 */
function describeNodeEnv(nodeEnv: string | undefined) {
  if (!nodeEnv) {
    return undefined
  }

  return KNOWN_NODE_ENVS.has(nodeEnv) ? nodeEnv : 'other'
}
