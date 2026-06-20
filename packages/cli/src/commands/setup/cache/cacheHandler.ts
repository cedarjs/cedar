import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { addEnvVarTask, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { addPackagesTask, getPaths, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'

const CLIENT_PACKAGE_MAP: Record<string, string> = {
  memcached: 'memjs',
  redis: 'redis',
}

const CLIENT_HOST_MAP: Record<string, string> = {
  memcached: 'localhost:11211',
  redis: 'redis://localhost:6379',
}

export const handler = async ({
  client,
  force,
}: {
  client: string
  force: boolean
}) => {
  const extension = isTypeScriptProject() ? 'ts' : 'js'

  const tasks = new Listr([
    await addPackagesTask({
      packages: [CLIENT_PACKAGE_MAP[client]],
      side: 'api',
    }),
    {
      title: `Writing api/src/lib/cache.${extension}`,
      task: () => {
        const template = fs
          .readFileSync(
            path.join(
              import.meta.dirname,
              'templates',
              `${client}.ts.template`,
            ),
          )
          .toString()

        return writeFile(
          path.join(getPaths().api.lib, `cache.${extension}`),
          template,
          {
            overwriteExisting: force,
          },
        )
      },
    },
    addEnvVarTask(
      'CACHE_HOST',
      CLIENT_HOST_MAP[client],
      `Where your ${client} server lives for service caching`,
    ),
    {
      title: 'One more thing...',
      task: (_ctx: unknown, task: { title: string }) => {
        task.title = `One more thing...\n
          ${c.tip('Check out the Service Cache docs for config and usage:')}
          ${terminalLink('', 'https://cedarjs.com/docs/services#caching')}
        `
      },
    },
  ])

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
