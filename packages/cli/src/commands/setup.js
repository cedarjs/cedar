import { terminalLink } from 'termi-link'

import detectRxVersion from '../middleware/detectProjectRxVersion.js'

import * as setupAuth from './setup/auth/auth.js'
import * as setupCache from './setup/cache/cache.js'
import * as setupDeploy from './setup/deploy/deploy.js'
import * as setupDocker from './setup/docker/docker.js'
import * as setupGenerator from './setup/generator/generator.js'
import * as setupGraphql from './setup/graphql/graphql.js'
import * as setupI18n from './setup/i18n/i18n.js'
import * as setupJobs from './setup/jobs/jobs.js'
import * as setupMailer from './setup/mailer/mailer.js'
import * as setupMiddleware from './setup/middleware/middleware.js'
import * as setupMonitoring from './setup/monitoring/monitoring.js'
import * as setupPackage from './setup/package/package.js'
import * as setupRealtime from './setup/realtime/realtime.js'
import * as setupServerFile from './setup/server-file/serverFile.js'
import * as setupTsconfig from './setup/tsconfig/tsconfig.js'
import * as setupUi from './setup/ui/ui.js'
import * as setupUploads from './setup/uploads/uploads.js'
import * as setupVite from './setup/vite/vite.js'

export const command = 'setup <command>'
export const description = 'Initialize project config and install packages'

export const builder = (yargs) =>
  yargs
    .command(setupAuth)
    .command(setupCache)
    .command(setupDeploy)
    .command(setupDocker)
    .command(setupGenerator)
    .command(setupGraphql)
    .command(setupI18n)
    .command(setupJobs)
    .command(setupMailer)
    .command(setupMiddleware)
    .command(setupMonitoring)
    .command(setupPackage)
    .command(setupRealtime)
    .command(setupServerFile)
    .command(setupTsconfig)
    .command(setupUi)
    .command(setupUploads)
    .command(setupVite)
    .demandCommand()
    .middleware(detectRxVersion)
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#setup',
      )}`,
    )
