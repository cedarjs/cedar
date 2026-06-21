import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'
import prompts from 'prompts'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  addPackagesTask,
  getPaths,
  printSetupNotes,
} from '../../../../lib/index.js'
import { addFilesTask } from '../helpers/index.js'
import { DEPLOY, ECOSYSTEM, MAINTENANCE } from '../templates/baremetal.js'

export const configFilename = 'deploy.toml'

const files = [
  {
    path: path.join(getPaths().base, configFilename),
    content: DEPLOY,
  },
  {
    path: path.join(getPaths().base, 'ecosystem.config.js'),
    content: ECOSYSTEM,
  },
  {
    path: path.join(getPaths().web.src, 'maintenance.html'),
    content: MAINTENANCE,
  },
]

const notes = [
  'You are almost ready to go BAREMETAL!',
  '',
  'See https://cedarjs.com/docs/deploy/baremetal for the remaining',
  'config and setup required before you can perform your first deploy.',
]

export const handler = async ({ force }) => {
  recordTelemetryAttributes({
    command: 'setup deploy baremetal',
    force,
  })

  // Warn users on Yarn PnP that the generated PM2 config most likely won't work
  // out of the box
  if (fs.existsSync(path.join(getPaths().base, '.pnp.cjs'))) {
    console.warn(
      c.warning(
        "Your project uses Yarn PnP (Plug'n'Play), which is not officially " +
          'supported for Baremetal deployments. The generated ' +
          'ecosystem.config.js file uses node_modules/.bin/cedar as the PM2 ' +
          'script path, which will most likely not work under PnP.\n\n' +
          'You will need to manually configure the server. See also the ' +
          'packageManagerCommand field in deploy.toml.',
      ),
    )
    console.log()

    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Generate the default config anyway? (You can edit it later)',
    })

    if (!confirmed) {
      console.log('Aborting baremetal setup.')
      return
    }

    console.log()
  }

  const tasks = new Listr(
    [
      await addPackagesTask({
        packages: ['node-ssh'],
        devDependency: true,
      }),
      addFilesTask({
        files,
        force,
      }),
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
