import fs from 'node:fs'
import path from 'node:path'

import type { Argv } from 'yargs'

import { terminalLink } from 'termi-link'

import {
  recordTelemetryAttributes,
  standardAuthBuilder,
} from '@cedarjs/cli-helpers'
import { addRootPackages } from '@cedarjs/cli-helpers/packageManager/packages'

import { getPaths } from '../../../lib/index.js'

export const command = 'auth <provider>'

export const description = 'Set up an auth configuration'

export async function builder(yargs: Argv) {
  yargs
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-auth',
      )}`,
    )
    // Command "redirects" for auth providers we used to support
    .command(...directToCustomAuthCommand('ethereum'))
    .command(...directToCustomAuthCommand('goTrue'))
    .command(...directToCustomAuthCommand('magicLink'))
    .command(...directToCustomAuthCommand('nhost'))
    .command(...directToCustomAuthCommand('okta'))
    // Auth providers we support
    .command(
      'auth0',
      'Set up auth for Auth0',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth auth0',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler('@cedarjs/auth-auth0-setup')
        console.log()
        handler(args)
      },
    )
    .command(
      ['azure-active-directory', 'azureActiveDirectory'],
      'Set up auth for Azure Active Directory',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth azure-active-directory',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler(
          '@cedarjs/auth-azure-active-directory-setup',
        )
        console.log()
        handler(args)
      },
    )
    .command(
      'clerk',
      'Set up auth for Clerk',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth clerk',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler('@cedarjs/auth-clerk-setup')
        console.log()
        handler(args)
      },
    )
    .command(
      'custom',
      'Set up a custom auth provider',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth custom',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler('@cedarjs/auth-custom-setup')
        console.log()
        handler(args)
      },
    )
    .command(
      'dbAuth',
      'Set up auth for dbAuth',
      (yargs: Argv) => {
        return standardAuthBuilder(yargs)
          .option('webauthn', {
            alias: 'w',
            default: null,
            description: 'Include WebAuthn support (TouchID/FaceID)',
            type: 'boolean',
          })
          .option('createUserModel', {
            alias: 'u',
            default: null,
            description: 'Create a User database model',
            type: 'boolean',
          })
          .option('generateAuthPages', {
            alias: 'g',
            default: null,
            description: 'Generate auth pages (login, signup, etc.)',
            type: 'boolean',
          })
      },
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth dbAuth',
          force: args.force,
          verbose: args.verbose,
          webauthn: args.webauthn,
        })
        const handler = await getAuthSetupHandler('@cedarjs/auth-dbauth-setup')
        console.log()
        handler(args)
      },
    )
    .command(
      'firebase',
      'Set up auth for Firebase',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth firebase',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler(
          '@cedarjs/auth-firebase-setup',
        )
        console.log()
        handler(args)
      },
    )
    .command(
      'netlify',
      'Set up auth for Netlify',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth netlify',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler('@cedarjs/auth-netlify-setup')
        console.log()
        handler(args)
      },
    )
    .command(
      'supabase',
      'Set up auth for Supabase',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth supabase',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler(
          '@cedarjs/auth-supabase-setup',
        )
        console.log()
        handler(args)
      },
    )
    .command(
      'supertokens',
      'Set up auth for SuperTokens',
      (yargs: Argv) => standardAuthBuilder(yargs),
      async (args: Record<string, unknown>) => {
        recordTelemetryAttributes({
          command: 'setup auth supertokens',
          force: args.force,
          verbose: args.verbose,
        })
        const handler = await getAuthSetupHandler(
          '@cedarjs/auth-supertokens-setup',
        )
        console.log()
        handler(args)
      },
    )
}

function directToCustomAuthCommand(
  provider: string,
): [string, boolean, () => void, () => void] {
  // cmd, description, builder, handler
  return [
    provider,
    false,
    () => {},
    () => {
      recordTelemetryAttributes({
        command: `setup auth ${provider}`,
      })

      const customAuthLink = terminalLink(
        'Custom Auth',
        'https://cedarjs.com/docs/auth/custom',
      )

      console.log(
        `${provider} is no longer supported out of the box. But you can ` +
          `still integrate it yourself with ${customAuthLink}`,
      )
    },
  ]
}

async function getAuthSetupHandler(module: string) {
  // Conditionally create a require function that works in ESM or use the
  // native one in CJS
  // TODO (ESM): Remove this once we've fully moved to ESM
  let customRequire: NodeRequire

  try {
    // Check if we're in an ESM context
    if (typeof require === 'undefined') {
      const { createRequire } = await import('node:module')
      customRequire = createRequire(import.meta.url)
    } else {
      // We're in a CJS context, so we use the native require
      customRequire = require
    }
  } catch {
    // Fallback to native require if something goes wrong
    customRequire = require
  }

  const packageJsonPath = customRequire.resolve('@cedarjs/cli/package.json')
  let { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version: string
  }

  if (!isInstalled(module)) {
    // If the version includes a plus, like '4.0.0-rc.428+dd79f1726'
    // (all @canary, @next, and @rc packages do), get rid of everything after
    // the plus.
    if (version.includes('+')) {
      version = version.split('+')[0]
    }

    let packument: unknown

    try {
      const packumentResponse = await fetch(
        `https://registry.npmjs.org/${module}`,
      )

      packument = await packumentResponse.json()

      if (
        packument !== null &&
        typeof packument === 'object' &&
        'error' in packument &&
        packument.error
      ) {
        throw new Error(String(packument.error))
      }
    } catch (e: unknown) {
      throw new Error(
        `Couldn't fetch packument for ${module}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    const versions =
      packument !== null &&
      typeof packument === 'object' &&
      'versions' in packument &&
      packument.versions !== null &&
      typeof packument.versions === 'object'
        ? packument.versions
        : {}

    const versionIsPublished = Object.keys(versions).includes(version)

    if (!versionIsPublished) {
      // Fallback to canary. This is most likely because it's a new package
      version = 'canary'
    }

    // We use `version` to make sure we install the same version of the auth
    // setup package as the rest of the Cedar packages
    await addRootPackages([`${module}@${version}`], {
      dev: true,
      stdio: 'inherit',
      cwd: getPaths().base,
    })
  }

  const setupModule = await import(module)

  return setupModule.default.handler
}

/**
 * Check if a user's project's package.json has a module listed as a dependency
 * or devDependency. If not, check node_modules.
 */
function isInstalled(module: string): boolean {
  const { dependencies, devDependencies } = JSON.parse(
    fs.readFileSync(path.join(getPaths().base, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const deps: Record<string, string> = {
    ...dependencies,
    ...devDependencies,
  }

  if (deps[module]) {
    return true
  }

  try {
    const possiblePaths = [
      path.join(getPaths().base, 'node_modules', module),
      path.join(getPaths().base, '..', 'node_modules', module),
      path.join(getPaths().api.base, 'node_modules', module),
      path.join(getPaths().web.base, 'node_modules', module),
    ]

    return possiblePaths.some((modulePath) => {
      return fs.existsSync(path.join(modulePath, 'package.json'))
    })
  } catch {
    // If there's an error checking, assume it's not installed
    return false
  }
}
