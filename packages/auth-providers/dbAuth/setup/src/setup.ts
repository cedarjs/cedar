import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

export const command = 'dbAuth'
export const description = 'Set up auth for for dbAuth'

export function builder(yargs: Argv) {
  yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
    .option('webauthn', {
      alias: 'w',
      default: null,
      description: 'Include WebAuthn support (TouchID/FaceID)',
      type: 'boolean',
    })
    .option('oauth', {
      alias: 'o',
      default: null,
      description:
        'Include OAuth support for the given comma-separated providers ' +
        '(google, github), e.g. --oauth google,github',
      type: 'string',
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
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-auth',
      )}`,
    )
}

export interface Args {
  webauthn: boolean | null
  // `undefined` is legal alongside `null`/a string: yargs supplies `null`
  // when the flag is parsed from argv and absent, but a caller that invokes
  // the setup handler directly (e.g. a test-project fixture rebuild) can
  // omit the property entirely, which comes through as `undefined`.
  oauth?: string | null
  createUserModel: boolean | null
  generateAuthPages: boolean | null
  force: boolean
}

export const handler = async (options: Args) => {
  const { handler } = await import('./setupHandler.js')
  return handler(options)
}
