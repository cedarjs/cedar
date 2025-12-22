import path from 'path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../../lib/colors.js'
import { getPaths, printSetupNotes } from '../../../../lib/index.js'
import { addFilesTask, updateApiURLTask } from '../helpers/index.js'
import { NETLIFY_TOML } from '../templates/netlify.js'

const files = [
  {
    path: path.join(getPaths().base, 'netlify.toml'),
    content: NETLIFY_TOML,
  },
]

const notes = [
  'You are ready to deploy to Netlify!',
  'See: https://cedarjs.com/docs/deploy/netlify',
]

export const handler = async ({ force }) => {
  recordTelemetryAttributes({
    command: 'setup deploy netlify',
    force,
  })
  const tasks = new Listr(
    [
      updateApiURLTask('/.netlify/functions'),
      addFilesTask({ files, force }),
      printSetupNotes(notes),
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )
  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
