import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

export const command = 'baremetal [environment]'
export const description = 'Deploy to baremetal server(s)'

export const builder = (yargs: Argv) => {
  yargs.positional('environment', {
    describe: 'The environment to deploy to',
    type: 'string',
  })

  yargs.option('first-run', {
    describe:
      'Set this flag the first time you deploy: starts server processes from ' +
      'scratch',
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
    describe: `Run \`${getPackageManager()} install\``,
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
    help:
      'Put up a maintenance page by replacing the content of ' +
      'web/dist/index.html with the content of web/src/maintenance.html',
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

  yargs.option('git-check', {
    describe: 'Check for unpushed commits before deploying',
    default: true,
    type: 'boolean',
  })

  // TODO: Allow option to pass --sides and only deploy select sides instead of
  // always deploying all sides

  yargs.epilogue(
    `Also see the ${terminalLink(
      'Cedar Baremetal Deploy Reference',
      'https://cedarjs.com/docs/cli-commands#deploy',
    )}\n`,
  )
}

<<<<<<< HEAD:packages/cli/src/commands/deploy/baremetal.js
export async function handler(yargs) {
<<<<<<< HEAD
  const { handler: importedHandler } =
=======
=======
interface BaremetalArgs {
  firstRun: boolean
  df: boolean
  update: boolean
  install: boolean
  migrate: boolean
  build: boolean
  restart: boolean
  cleanup: boolean
  maintenance?: string
  rollback?: number
  verbose: boolean
  gitCheck: boolean
  releaseDir: string
  branch?: string
}

export async function handler(yargs: BaremetalArgs) {
>>>>>>> 28c0c97f08 (chore(cli): migrate serverless, baremetal, nft, chakra-ui, mantine, jobs, merge/index from JS to TS (#2011)):packages/cli/src/commands/deploy/baremetal.ts
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
    gitCheck: yargs.gitCheck,
  })

  const { handler: baremetalHandler } =
<<<<<<< HEAD:packages/cli/src/commands/deploy/baremetal.js
>>>>>>> 727aa28c93 (feat(baremetal)!: warn on unpushed commits before deploying (#1904))
=======
    // @ts-expect-error - baremetalHandler.js has no type declarations yet
>>>>>>> 28c0c97f08 (chore(cli): migrate serverless, baremetal, nft, chakra-ui, mantine, jobs, merge/index from JS to TS (#2011)):packages/cli/src/commands/deploy/baremetal.ts
    await import('./baremetal/baremetalHandler.js')

  return importedHandler(yargs)
}
