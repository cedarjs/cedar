import path from 'path'

import execa from 'execa'
import fs from 'fs-extra'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getPaths } from '@cedarjs/project-config'

export const handler = async ({ side, serve, prisma, dm: dataMigrate }) => {
  recordTelemetryAttributes({
    command: 'deploy flightcontrol',
    side,
    prisma,
    dataMigrate,
    serve,
  })
  const rwjsPaths = getPaths()

  const execaConfig = {
    cwd: rwjsPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runApiCommands() {
    if (!serve) {
      console.log('Building api...')
      execa.commandSync('yarn rw build api --verbose', execaConfig)

      if (prisma) {
        console.log('Running database migrations...')
        execa.commandSync(
          `node_modules/.bin/prisma migrate deploy --config "${rwjsPaths.api.prismaConfig}"`,
          execaConfig,
        )
      }

      if (dataMigrate) {
        console.log('Running data migrations...')
        execa.commandSync('yarn rw dataMigrate up', execaConfig)
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
    execa.commandSync('yarn rw build web --verbose', execaConfig)
  }

  if (side === 'api') {
    runApiCommands()
  } else if (side === 'web') {
    runWebCommands()
  }
}
