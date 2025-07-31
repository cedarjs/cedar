import path from 'path'

import execa from 'execa'
import fs from 'fs-extra'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getPaths } from '@cedarjs/project-config'

export interface HandlerArgs {
  side: 'api' | 'web'
  prisma: boolean
  serve: boolean
  dm: boolean
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
  const rwjsPaths = getPaths()

  const execaConfig: execa.Options = {
    cwd: rwjsPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runExecaCommand(command: string) {
    const result = await execa.command(command, execaConfig)

    if (result.failed) {
      throw new Error(`Command (${command}) failed`)
    }

    return result
  }

  async function runApiCommands() {
    if (!serve) {
      console.log('Building api...')
      await runExecaCommand('yarn rw build api --verbose')

      if (prisma) {
        console.log('Running database migrations...')
        await runExecaCommand(
          `node_modules/.bin/prisma migrate deploy --schema "${rwjsPaths.api.dbSchema}"`,
        )
      }

      if (dataMigrate) {
        console.log('Running data migrations...')
        await runExecaCommand('yarn rw dataMigrate up')
      }

      return
    }

    const serverFilePath = path.join(rwjsPaths.api.dist, 'server.js')
    const hasServerFile = fs.pathExistsSync(serverFilePath)

    if (hasServerFile) {
      execa(`yarn node ${serverFilePath}`, execaConfig)
    } else {
      const { handler } = await import(
        '@cedarjs/api-server/apiCliConfigHandler'
      )
      handler()
    }
  }

  async function runWebCommands() {
    console.log('Building web...')
    await runExecaCommand('yarn rw build web --verbose')
  }

  if (side === 'api') {
    await runApiCommands()
  } else if (side === 'web') {
    await runWebCommands()
  }
}
