import fs from 'node:fs'
import path from 'path'

import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { formatAddRootPackagesCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { runBin, runBinSync } from '@cedarjs/cli-helpers/packageManager/exec'
import { installPackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { getPaths } from '@cedarjs/project-config'

export const handler = async ({ side, prisma, dataMigrate }) => {
  recordTelemetryAttributes({
    command: 'deploy render',
    side,
    prisma,
    dataMigrate,
  })

  const cedarPaths = getPaths()

  const execaConfig = {
    cwd: cedarPaths.base,
    shell: true,
    stdio: 'inherit',
  }

  async function runApiCommands() {
    if (prisma) {
      console.log('Running database migrations...')
      execa.commandSync(
        `node_modules/.bin/prisma migrate deploy --config "${cedarPaths.api.prismaConfig}"`,
        execaConfig,
      )
    }

    if (dataMigrate) {
      console.log('Running data migrations...')
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(cedarPaths.base, 'package.json'), 'utf-8'),
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
            formatAddRootPackagesCommand(['@cedarjs/cli-data-migrate'], true),
            '```',
          ].join('\n'),
        )
      } else {
        runBinSync('cedar', ['dataMigrate', 'up'], execaConfig)
      }
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
    await installPackages(execaConfig)
    runBinSync('cedar', ['build', 'web', '--verbose'], execaConfig)
  }

  if (side === 'api') {
    runApiCommands()
  } else if (side === 'web') {
    runWebCommands()
  }
}
