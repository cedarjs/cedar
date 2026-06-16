import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import {
  getNodeRunnerArgs,
  runBin,
} from '@cedarjs/cli-helpers/packageManager/exec'
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
<<<<<<< HEAD
      await runExecaCommand('yarn rw build api --verbose')
=======
      await runBinWithError('cedar', ['build', 'api', '--verbose'], execaConfig)
>>>>>>> 7982d76ba7 (feat(pm): Package manager agnostic deploy commands (#1925))

      if (prisma) {
        console.log('Running database migrations...')
        await execa.command(
          `node_modules/.bin/prisma migrate deploy --config "${cedarPaths.api.prismaConfig}"`,
          execaConfig,
        )
      }

      if (dataMigrate) {
        console.log('Running data migrations...')
<<<<<<< HEAD
        await runExecaCommand('yarn rw dataMigrate up')
=======
        await runBinWithError('cedar', ['dataMigrate', 'up'], execaConfig)
>>>>>>> 7982d76ba7 (feat(pm): Package manager agnostic deploy commands (#1925))
      }

      return
    }

    const serverFilePath = path.join(cedarPaths.api.dist, 'server.js')
    const hasServerFile = fs.existsSync(serverFilePath)

    if (hasServerFile) {
      execa(...getNodeRunnerArgs(serverFilePath), execaConfig)
    } else {
      const { handler } =
        await import('@cedarjs/api-server/apiCliConfigHandler')
      handler()
    }
  }

  async function runWebCommands() {
    console.log('Building web...')
<<<<<<< HEAD
    await runExecaCommand('yarn rw build web --verbose')
=======
    await runBinWithError('cedar', ['build', 'web', '--verbose'], execaConfig)
>>>>>>> 7982d76ba7 (feat(pm): Package manager agnostic deploy commands (#1925))
  }

  if (side === 'api') {
    await runApiCommands()
  } else if (side === 'web') {
    await runWebCommands()
  }
}
