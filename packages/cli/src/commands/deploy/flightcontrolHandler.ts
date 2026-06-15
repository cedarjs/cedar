import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { getPaths } from '@cedarjs/project-config'

export interface HandlerArgs {
  side: 'api' | 'web'
  prisma: boolean
  serve: boolean
  dm: boolean
}

/**
 * Wraps runBin to throw a consistent error on failure, matching the previous
 * execa.command pattern used by flightcontrol deploy.
 */
async function runBinWithError(
  bin: string,
  args: string[],
  options?: execa.Options,
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

  const execaConfig: execa.Options = {
    cwd: cedarPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runApiCommands() {
    if (!serve) {
      console.log('Building api...')
      await runBinWithError('cedar', ['build', 'api', '--verbose'], execaConfig)

      if (prisma) {
        console.log('Running database migrations...')
        await execa.command(
          `node_modules/.bin/prisma migrate deploy --config "${cedarPaths.api.prismaConfig}"`,
          execaConfig,
        )
      }

      if (dataMigrate) {
        console.log('Running data migrations...')
        await runBinWithError('cedar', ['dataMigrate', 'up'], execaConfig)
      }

      return
    }

    const serverFilePath = path.join(cedarPaths.api.dist, 'server.js')
    const hasServerFile = fs.existsSync(serverFilePath)

    if (hasServerFile) {
      runBin('node', [serverFilePath], execaConfig)
    } else {
      const { handler } =
        await import('@cedarjs/api-server/apiCliConfigHandler')
      handler()
    }
  }

  async function runWebCommands() {
    console.log('Building web...')
    await runBinWithError('cedar', ['build', 'web', '--verbose'], execaConfig)
  }

  if (side === 'api') {
    await runApiCommands()
  } else if (side === 'web') {
    await runWebCommands()
  }
}
