import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import detectRxVersion from '../middleware/detectProjectRxVersion.js'

// @ts-expect-error - Types not available for JS files
import * as setupAuth from './setup/auth/auth.js'
// @ts-expect-error - Types not available for JS files
import * as setupCache from './setup/cache/cache.js'
// @ts-expect-error - Types not available for JS files
import * as setupDeploy from './setup/deploy/deploy.js'
// @ts-expect-error - Types not available for JS files
import * as setupDocker from './setup/docker/docker.js'
// @ts-expect-error - Types not available for JS files
import * as setupGenerator from './setup/generator/generator.js'
import * as setupGraphql from './setup/graphql/graphql.js'
// @ts-expect-error - Types not available for JS files
import * as setupI18n from './setup/i18n/i18n.js'
// @ts-expect-error - Types not available for JS files
import * as setupJobs from './setup/jobs/jobs.js'
// @ts-expect-error - Types not available for JS files
import * as setupMailer from './setup/mailer/mailer.js'
import * as setupMiddleware from './setup/middleware/middleware.js'
import * as setupMonitoring from './setup/monitoring/monitoring.js'
// @ts-expect-error - Types not available for JS files
import * as setupPackage from './setup/package/package.js'
// @ts-expect-error - Types not available for JS files
import * as setupRealtime from './setup/realtime/realtime.js'
// @ts-expect-error - Types not available for JS files
import * as setupServerFile from './setup/server-file/serverFile.js'
// @ts-expect-error - Types not available for JS files
import * as setupTsconfig from './setup/tsconfig/tsconfig.js'
import * as setupUi from './setup/ui/ui.js'
// @ts-expect-error - Types not available for JS files
import * as setupUploads from './setup/uploads/uploads.js'
// @ts-expect-error - Types not available for JS files
import * as setupVite from './setup/vite/vite.js'

export const command = 'setup <command>'
export const description = 'Initialize project config and install packages'

export const builder = (yargs: Argv) =>
  yargs
    .command(setupAuth)
    .command(setupCache)
    .command(setupDeploy)
    .command(setupDocker)
    .command(setupGenerator)
    // @ts-expect-error - Yargs TS types aren't very good
    .command(setupGraphql)
    .command(setupI18n)
    .command(setupJobs)
    .command(setupMailer)
    // @ts-expect-error - Yargs TS types aren't very good
    .command(setupMiddleware)
    // @ts-expect-error - Yargs TS types aren't very good
    .command(setupMonitoring)
    .command(setupPackage)
    .command(setupRealtime)
    .command(setupServerFile)
    .command(setupTsconfig)
    // @ts-expect-error - Yargs TS types aren't very good
    .command(setupUi)
    .command(setupUploads)
    .command(setupVite)
    .demandCommand()
    // @ts-expect-error - Yargs TS types aren't very good
    .middleware(detectRxVersion)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup',
      )}`,
    )
