import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'baremetal [environment]'
export const description = 'Deploy to baremetal server(s)'

export const builder = (yargs) => {
  yargs.positional('environment', {
    describe: 'The environment to deploy to',
    type: 'string',
  })

  yargs.option('first-run', {
    describe:
      'Set this flag the first time you deploy: starts server processes from scratch',
    default: false,
    type: 'boolean',
  })

  yargs.option('df', {
    describe: 'Check available disk space',
    default: true,
    type: 'boolean',
  })

  yargs.option('update', {
    describe: 'Update code to latest revision',
    default: true,
    type: 'boolean',
  })

  yargs.option('install', {
    describe: 'Run `yarn install`',
    default: true,
    type: 'boolean',
  })

  yargs.option('migrate', {
    describe: 'Run database migration tasks',
    default: true,
    type: 'boolean',
  })

  yargs.option('build', {
    describe: 'Run build process for the deployed `sides`',
    default: true,
    type: 'boolean',
  })

  yargs.option('restart', {
    describe: 'Restart server processes',
    default: true,
    type: 'boolean',
  })

  yargs.option('cleanup', {
    describe: 'Remove old deploy directories',
    default: true,
    type: 'boolean',
  })

  yargs.option('releaseDir', {
    describe:
      'Directory to create for the latest release, defaults to timestamp',
    default: new Date()
      .toISOString()
      .replace(/[:\-TZ]/g, '')
      .replace(/\.\d+$/, ''),
    type: 'string',
  })

  yargs.option('branch', {
    describe: 'The branch to deploy',
    type: 'string',
  })

  yargs.option('maintenance', {
    describe: 'Add/remove the maintenance page',
    choices: ['up', 'down'],
    help: 'Put up a maintenance page by replacing the content of web/dist/index.html with the content of web/src/maintenance.html',
  })

  yargs.option('rollback', {
    describe: 'Add/remove the maintenance page',
    help: 'Rollback [count] number of releases',
  })

  yargs.option('verbose', {
    describe: 'Verbose mode, for debugging purposes',
    default: false,
    type: 'boolean',
  })

  // TODO: Allow option to pass --sides and only deploy select sides instead of all, always

  yargs.epilogue(
    `Also see the ${terminalLink(
      'Redwood Baremetal Deploy Reference',
      'https://redwoodjs.com/docs/cli-commands#deploy',
    )}\n`,
  )
}

export async function handler(yargs) {
  recordTelemetryAttributes({
    command: 'deploy baremetal',
    firstRun: yargs.firstRun,
    df: yargs.df,
    update: yargs.update,
    install: yargs.install,
    migrate: yargs.migrate,
    build: yargs.build,
    restart: yargs.restart,
    cleanup: yargs.cleanup,
    maintenance: yargs.maintenance,
    rollback: yargs.rollback,
    verbose: yargs.verbose,
  })

  const { handler: baremetalHandler } = await import(
    './baremetal/baremetalHandler.js'
  )

  return baremetalHandler(yargs)
}
