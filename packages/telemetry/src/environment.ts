import os from 'node:os'

import ci from 'ci-info'
import envinfo from 'envinfo'

import type { TelemetryEnvironment } from './payload.js'

interface EnvInfo {
  System?: {
    OS?: string
    Shell?: { path?: string }
  }
  Binaries?: {
    Node?: { version?: string }
    Yarn?: { version?: string }
    npm?: { version?: string }
  }
  IDEs?: {
    VSCode?: { version?: string }
  }
}

export async function getTelemetryEnvironment(): Promise<TelemetryEnvironment> {
  let info: EnvInfo = {}

  try {
    info = JSON.parse(
      await envinfo.run(
        {
          System: ['OS', 'Shell'],
          Binaries: ['Node', 'Yarn', 'npm'],
          IDEs: ['VSCode'],
        },
        { json: true },
      ),
    )
  } catch {
    // Everything envinfo provides is optional, so a failure just leaves those
    // fields empty
  }

  const [osType, osVersion] = info.System?.OS?.split(' ') ?? []

  return {
    osType,
    osVersion,
    // Only the name of the shell, never the path to it
    shell: info.System?.Shell?.path?.split(/[\\/]/).pop(),
    nodeVersion: info.Binaries?.Node?.version,
    yarnVersion: info.Binaries?.Yarn?.version,
    npmVersion: info.Binaries?.npm?.version,
    vscodeVersion: info.IDEs?.VSCode?.version,
    cpuCount: os.availableParallelism(),
    memoryGb: Math.round(os.totalmem() / 1073741824),
    nodeEnv: process.env.NODE_ENV || undefined,
    ci: ci.isCI,
    cedarCi: !!process.env.CEDAR_CI,
    devEnvironment: Object.keys(process.env).some((key) =>
      key.startsWith('GITPOD_'),
    )
      ? 'gitpod'
      : undefined,
  }
}
