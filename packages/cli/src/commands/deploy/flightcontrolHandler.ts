import fs from 'node:fs'
import path from 'node:path'

import type { Options as ExecaOptions } from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { runBin, runWithNode } from '@cedarjs/cli-helpers/packageManager/exec'
import { getPaths } from '@cedarjs/project-config'

export interface HandlerArgs {
  side: 'api' | 'web'
  prisma: boolean
  serve: boolean
  dm: boolean
}

async function runBinWithThrow(
  bin: string,
  args: string[],
  options?: ExecaOptions,
) {
  const result = await runBin(bin, args, options)

  if (result.failed) {
    throw new Error(`Command (${bin} ${args.join(' ')}) failed`)
  }

  return result
}

export const handler = async ({
  side,
  serve,
  prisma,
  dm: dataMigrate,
}: HandlerArgs) => {
  recordTelemetryAttributes({
    command: 'deploy flightcontrol',
    side,
    prisma,
    dataMigrate,
    serve,
  })
  const cedarPaths = getPaths()

  const execaConfig: ExecaOptions = {
    cwd: cedarPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runApiCommands() {
    if (!serve) {
      console.log('Building api...')
      await runBinWithThrow('cedar', ['build', 'api', '--verbose'], execaConfig)

      if (prisma) {
        console.log('Running database migrations...')
        await runBinWithThrow(
          'prisma',
          ['migrate', 'deploy', '--config', cedarPaths.api.prismaConfig],
          execaConfig,
        )
      }

      if (dataMigrate) {
        console.log('Running data migrations...')
        await runBinWithThrow('cedar', ['dataMigrate', 'up'], execaConfig)
      }

      return
    }

    const serverFilePath = path.join(cedarPaths.api.dist, 'server.js')
    const hasServerFile = fs.existsSync(serverFilePath)

    if (hasServerFile) {
      runWithNode(serverFilePath, execaConfig)
    } else {
      const { handler } =
        await import('@cedarjs/api-server/apiCliConfigHandler')
      handler()
    }
  }

  async function runWebCommands() {
    console.log('Building web...')
    await runBinWithThrow('cedar', ['build', 'web', '--verbose'], execaConfig)
  }

  if (side === 'api') {
    await runApiCommands()
  } else if (side === 'web') {
    await runWebCommands()
  }
}
