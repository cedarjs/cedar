import path from 'path'

import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  getInstalledCedarVersion,
  getPaths,
  saveRemoteFileToDisk,
} from '../../../lib/index.js'

export const handler = async ({ force }: { force: boolean }) => {
  const installedRwVersion = await getInstalledCedarVersion()
  const GITHUB_VERSION_TAG = installedRwVersion.match('canary')
    ? 'main'
    : `v${installedRwVersion}`

  const CRWA_TEMPLATE_URL = `https://raw.githubusercontent.com/redwoodjs/redwood/${GITHUB_VERSION_TAG}/packages/create-cedar-app/templates/ts`

  const tasks = new Listr(
    [
      {
        title: 'Creating tsconfig in web',
        task: () => {
          const webConfigPath = path.join(getPaths().web.base, 'tsconfig.json')

          const templateUrl = `${CRWA_TEMPLATE_URL}/web/tsconfig.json`

          return saveRemoteFileToDisk(templateUrl, webConfigPath, {
            overwriteExisting: force,
          })
        },
      },
      {
        title: 'Creating tsconfig in api',
        task: () => {
          const webConfigPath = path.join(getPaths().api.base, 'tsconfig.json')

          const templateUrl = `${CRWA_TEMPLATE_URL}/api/tsconfig.json`

          return saveRemoteFileToDisk(templateUrl, webConfigPath, {
            overwriteExisting: force,
          })
        },
      },
      {
        title: 'One more thing...',
        task: (_ctx: unknown, task: { title: string }) => {
          task.title = `One more thing...\n
          ${c.tip('Quick link to the docs on configuring TypeScript')}
          ${terminalLink('', 'https://cedarjs.com/docs/typescript')}
        `
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    // exitCode is a non-standard property Listr2 errors may carry
    const exitCode =
      e instanceof Error && 'exitCode' in e
        ? (e as Error & { exitCode: unknown }).exitCode
        : undefined
    process.exit(typeof exitCode === 'number' ? exitCode : 1)
  }
}
