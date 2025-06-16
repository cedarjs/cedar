import path from 'node:path'

import execa from 'execa'
import fs from 'fs-extra'
import { terminalLink } from 'termi-link'

import {
  recordTelemetryAttributes,
  standardAuthBuilder,
} from '@cedarjs/cli-helpers'

import { getPaths } from '../../../lib/index.js'

export const command = 'auth <provider>'

export const description = 'Set up an auth configuration'

export async function builder(yargs) {
  yargs
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#setup-auth',
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => {
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
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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
      (yargs) => standardAuthBuilder(yargs),
      async (args) => {
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

/**
 * @param {string} provider
 * @returns {[string, boolean, () => void, () => void]}
 */
function directToCustomAuthCommand(provider) {
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
        'https://redwoodjs.com/docs/auth/custom',
      )

      console.log(
        `${provider} is no longer supported out of the box. But you can ` +
          `still integrate it yourself with ${customAuthLink}`,
      )
    },
  ]
}

/**
 * @param {string} module
 */
async function getAuthSetupHandler(module) {
  // Conditionally create a require function that works in ESM or use the
  // native one in CJS
  // TODO (ESM): Remove this once we've fully moved to ESM
  let customRequire

  try {
    // Check if we're in an ESM context
    if (typeof require === 'undefined') {
      const { createRequire } = await import('node:module')
      customRequire = createRequire(import.meta.url)
    } else {
      // We're in a CJS context, so we use the native require
      customRequire = require
    }
  } catch (error) {
    // Fallback to native require if something goes wrong
    customRequire = require
  }

  const packageJsonPath = customRequire.resolve('@cedarjs/cli/package.json')
  let { version } = fs.readJSONSync(packageJsonPath)

  if (!isInstalled(module)) {
    // If the version includes a plus, like '4.0.0-rc.428+dd79f1726'
    // (all @canary, @next, and @rc packages do), get rid of everything after the plus.
    if (version.includes('+')) {
      version = version.split('+')[0]
    }

    let packument

    try {
      const packumentResponse = await fetch(
        `https://registry.npmjs.org/${module}`,
      )

      packument = await packumentResponse.json()

      if (packument.error) {
        throw new Error(packument.error)
      }
    } catch (error) {
      throw new Error(
        `Couldn't fetch packument for ${module}: ${error.message}`,
      )
    }

    const versionIsPublished = Object.keys(packument.versions).includes(version)

    if (!versionIsPublished) {
      // Fallback to canary. This is most likely because it's a new package
      version = 'canary'
    }

    // We use `version` to make sure we install the same version of the auth
    // setup package as the rest of the RW packages
    await execa.command(`yarn add -D ${module}@${version}`, {
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
 *
 * @param {string} module
 */
function isInstalled(module) {
  const { dependencies, devDependencies } = fs.readJSONSync(
    path.join(getPaths().base, 'package.json'),
  )

  const deps = {
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
  } catch (error) {
    // If there's an error checking, assume it's not installed
    return false
  }
}
