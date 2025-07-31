import path from 'path'

import execa from 'execa'
import fs from 'fs-extra'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getPaths } from '@cedarjs/project-config'

export const handler = async ({ side, prisma, dataMigrate }) => {
  recordTelemetryAttributes({
    command: 'deploy render',
    side,
    prisma,
    dataMigrate,
  })

  const rwjsPaths = getPaths()

  const execaConfig = {
    cwd: rwjsPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runApiCommands() {
    if (prisma) {
      console.log('Running database migrations...')
      execa.commandSync(
        `node_modules/.bin/prisma migrate deploy --schema "${rwjsPaths.api.dbSchema}"`,
        execaConfig,
      )
    }

    if (dataMigrate) {
      console.log('Running data migrations...')
      const packageJson = fs.readJsonSync(
        path.join(rwjsPaths.base, 'package.json'),
      )
      const hasDataMigratePackage =
        !!packageJson.devDependencies['@cedarjs/cli-data-migrate']

      if (!hasDataMigratePackage) {
        console.error(
          [
            "Skipping data migrations; your project doesn't have the `@cedarjs/cli-data-migrate` package as a dev dependency.",
            "Without it installed, you're likely to run into memory issues during deploy.",
            "If you want to run data migrations, add the package to your project's root package.json and deploy again:",
            '',
            '```',
            'yarn add -D @cedarjs/cli-data-migrate',
            '```',
          ].join('\n'),
        )
      } else {
        execa.commandSync('yarn rw dataMigrate up', execaConfig)
      }
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
    execa.commandSync('yarn install', execaConfig)
    execa.commandSync('yarn rw build web --verbose', execaConfig)
  }

  if (side === 'api') {
    runApiCommands()
  } else if (side === 'web') {
    runWebCommands()
  }
}
