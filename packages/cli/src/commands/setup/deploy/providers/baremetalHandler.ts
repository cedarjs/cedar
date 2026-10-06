import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'
import prompts from 'prompts'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  addPackagesTask,
  getPaths,
  printSetupNotes,
} from '../../../../lib/index.js'
import { MONITORS, isMonitor } from '../../../deploy/baremetal/monitors.js'
import type { Monitor } from '../../../deploy/baremetal/monitors.js'
import { addFilesTask } from '../helpers/index.js'
import {
  MAINTENANCE,
  SYSTEMD_DIR,
  deployToml,
  ecosystemConfig,
  systemdJobsUnit,
  systemdServiceUnit,
} from '../templates/baremetal.js'

export const configFilename = 'deploy.toml'

const MONITOR_CHOICES: {
  title: string
  description: string
  value: Monitor
}[] = [
  {
    title: 'pm2',
    description: 'Node process manager, configured in ecosystem.config.js',
    value: 'pm2',
  },
  {
    title: 'systemd (user units)',
    description:
      'Units in ~/.config/systemd/user, managed by the deploy user without sudo',
    value: 'systemd-user',
  },
  {
    title: 'systemd (system units)',
    description: 'Units in /etc/systemd/system, managed with sudo systemctl',
    value: 'systemd-system',
  },
]

/**
 * Name for the systemd units, derived from the project directory. Lowercase
 * letters, digits and dashes only, so it is valid in a unit file name.
 */
export const appNameFromPath = (projectPath: string) => {
  const name = path
    .basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return name || 'cedar'
}

export interface SetupFile {
  path: string
  content: string
}

/**
 * The files `setup deploy baremetal` writes for a monitor, and the process
 * names those files define. pm2 gets an ecosystem file, systemd gets unit
 * files. Projects with background jobs set up get a jobs worker process too.
 */
export const setupFiles = ({
  monitor,
  jobs,
  appName,
  basePath,
  webSrcPath,
}: {
  monitor: Monitor
  jobs: boolean
  appName: string
  basePath: string
  webSrcPath: string
}): { files: SetupFile[]; processNames: string[] } => {
  const files: SetupFile[] = []
  let processNames: string[]

  if (monitor === 'pm2') {
    processNames = jobs ? ['serve', 'jobs'] : ['serve']
    files.push({
      path: path.join(basePath, 'ecosystem.config.js'),
      content: ecosystemConfig({ jobs }),
    })
  } else {
    const jobsUnit = `${appName}-jobs`
    processNames = jobs ? [appName, `${jobsUnit}@0`] : [appName]
    files.push({
      path: path.join(basePath, SYSTEMD_DIR, `${appName}.service`),
      content: systemdServiceUnit({ appName, monitor }),
    })

    if (jobs) {
      files.push({
        path: path.join(basePath, SYSTEMD_DIR, `${jobsUnit}@.service`),
        content: systemdJobsUnit({ appName, monitor }),
      })
    }
  }

  files.unshift({
    path: path.join(basePath, configFilename),
    content: deployToml({ monitor, processNames }),
  })
  files.push({
    path: path.join(webSrcPath, 'maintenance.html'),
    content: MAINTENANCE,
  })

  return { files, processNames }
}

const notesFor = (monitor: Monitor, jobs: boolean, processNames: string[]) => {
  const notes = ['You are almost ready to go BAREMETAL!', '']

  if (monitor !== 'pm2') {
    notes.push(
      `Copy the unit files in ${SYSTEMD_DIR}/ to the server before your first`,
      'deploy. The comments at the top of each file say where they go.',
      '',
    )
  }

  if (jobs) {
    notes.push(
      `Background jobs are set up, so deploy.toml lists a jobs worker process`,
      `(${processNames[processNames.length - 1]}). Add one per entry in the`,
      '`workers` array of api/src/lib/jobs.ts.',
      '',
    )
  }

  notes.push(
    'See https://cedarjs.com/docs/deploy/baremetal for the remaining',
    'config and setup required before you can perform your first deploy.',
  )

  return notes
}

const promptForMonitor = async (): Promise<Monitor | undefined> => {
  const { monitor } = await prompts({
    type: 'select',
    name: 'monitor',
    message: 'Which process monitor will run your app on the server?',
    choices: MONITOR_CHOICES,
  })

  return isMonitor(monitor) ? monitor : undefined
}

export const handler = async ({
  force,
  monitor: monitorOption,
}: {
  force: boolean
  monitor?: string
}) => {
  recordTelemetryAttributes({
    command: 'setup deploy baremetal',
    force,
    monitor: monitorOption,
  })

  if (monitorOption !== undefined && !isMonitor(monitorOption)) {
    console.error(
      c.error(
        `Unknown monitor "${monitorOption}". Use one of ${MONITORS.join(', ')}.`,
      ),
    )
    process.exit(1)
  }

  const monitor = monitorOption ?? (await promptForMonitor())

  if (!monitor) {
    console.log('Aborting baremetal setup.')
    return
  }

  const paths = getPaths()

  // Warn users on Yarn PnP that the generated process config most likely won't
  // work out of the box
  if (fs.existsSync(path.join(paths.base, '.pnp.cjs'))) {
    console.warn(
      c.warning(
        "Your project uses Yarn PnP (Plug'n'Play), which is not officially " +
          'supported for Baremetal deployments. The generated process ' +
          'config starts the app with node_modules/.bin/cedar, which will ' +
          'most likely not work under PnP.\n\n' +
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

  const jobs = Boolean(paths.api.jobsConfig)
  const { files, processNames } = setupFiles({
    monitor,
    jobs,
    appName: appNameFromPath(paths.base),
    basePath: paths.base,
    webSrcPath: paths.web.src,
  })

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
      printSetupNotes(notesFor(monitor, jobs, processNames)),
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )
  try {
    await tasks.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}
