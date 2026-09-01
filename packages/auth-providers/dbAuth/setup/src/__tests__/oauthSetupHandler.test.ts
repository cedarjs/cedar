import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import {
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest'

import type { AuthHandlerArgs } from '@cedarjs/cli-helpers'

vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

import { handler } from '../setupHandler'

const CEDAR_CWD = process.env.CEDAR_CWD

const { cedarProjectPath } = vi.hoisted(() => {
  return { cedarProjectPath: '/cedar-app' }
})

vi.mock('prompts', () => {
  return {
    __esModule: true,
    default: vi.fn(async (args: any) => {
      return {
        [args.name]: false,
      }
    }),
  }
})

vi.mock('../shared', () => ({
  hasModel: () => false,
  hasAuthPages: () => false,
  generateAuthPagesTask: () => undefined,
  getModelNames: () => ['ExampleUser'],
  functionsPath: () => cedarProjectPath + '/api/src/functions',
  libPath: () => cedarProjectPath + '/api/src/lib',
}))

// Unlike `setup.test.ts`'s mock, this one records the full args
// `standardAuthHandler` was called with, so `apiPackages`/`webAuthn`/`oauth`
// and the extra tasks passed through by `setupHandler` can be asserted on
// directly, in addition to the printed notes.
let lastStandardAuthHandlerArgs: AuthHandlerArgs | undefined

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    getGraphqlPath: () => {
      return cedarProjectPath + '/api/src/functions/graphql.ts'
    },
    addEnvVarTask: () => undefined,
    getPaths: () => ({
      base: cedarProjectPath,
    }),
    colors: {
      error: (str: string) => str,
      warning: (str: string) => str,
      green: (str: string) => str,
      info: (str: string) => str,
      bold: (str: string) => str,
      underline: (str: string) => str,
    },
    standardAuthHandler: async (args: AuthHandlerArgs) => {
      lastStandardAuthHandlerArgs = args

      if (args.notes) {
        console.log(`\n   ${args.notes.join('\n   ')}\n`)
      }
    },
  }
})

beforeAll(() => {
  process.env.CEDAR_CWD = cedarProjectPath
})

afterAll(() => {
  process.env.CEDAR_CWD = CEDAR_CWD
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  lastStandardAuthHandlerArgs = undefined

  const packageJsonPath = path.resolve(__dirname, '../../package.json')
  vol.fromJSON(
    { [packageJsonPath]: '{ "version": "6.0.1" }' },
    cedarProjectPath,
  )
})

afterEach(() => {
  vi.mocked(console).log.mockRestore?.()
})

describe('dbAuth setup command -- --oauth', () => {
  it('leaves apiPackages/webAuthn/oauth unchanged when --oauth is not passed', async () => {
    await handler({
      webauthn: false,
      oauth: null,
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    expect(lastStandardAuthHandlerArgs?.oauth).toBe(false)
    expect(lastStandardAuthHandlerArgs?.apiPackages).toEqual([
      '@cedarjs/auth-dbauth-api@6.0.1',
    ])
  })

  it('rejects an unknown provider, naming the custom-strategy escape hatch', async () => {
    await expect(
      handler({
        webauthn: false,
        oauth: 'facebook',
        createUserModel: false,
        generateAuthPages: true,
        force: false,
      }),
    ).rejects.toThrow(/custom-strategy escape hatch/)
  })

  it('rejects an empty --oauth value', async () => {
    await expect(
      handler({
        webauthn: false,
        oauth: '',
        createUserModel: false,
        generateAuthPages: true,
        force: false,
      }),
    ).rejects.toThrow(/at least one provider/)
  })

  it('adds the oauth package and oauth4webapi to apiPackages for --oauth google,github', async () => {
    await handler({
      webauthn: false,
      oauth: 'google,github',
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    expect(lastStandardAuthHandlerArgs?.oauth).toBe(true)
    expect(lastStandardAuthHandlerArgs?.apiPackages).toEqual([
      '@cedarjs/auth-dbauth-api@6.0.1',
      '@cedarjs/auth-dbauth-oauth@6.0.1',
      'oauth4webapi@^3',
    ])
  })

  it('includes a configureOAuthProvidersTask extra task when oauth is enabled', async () => {
    await handler({
      webauthn: false,
      oauth: 'google',
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    expect(
      lastStandardAuthHandlerArgs?.extraTasks?.some(
        (task) => task?.title === 'Configuring selected OAuth providers...',
      ),
    ).toBe(true)
  })

  it('omits the configureOAuthProvidersTask extra task when oauth is disabled', async () => {
    await handler({
      webauthn: false,
      oauth: null,
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    expect(
      lastStandardAuthHandlerArgs?.extraTasks?.some(
        (task) => task?.title === 'Configuring selected OAuth providers...',
      ),
    ).toBe(false)
  })

  it('prints OAuth schema and env var guidance in the notes when set up against an existing User model', async () => {
    await handler({
      webauthn: false,
      oauth: 'google,github',
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    const printedNotes = vi.mocked(console).log.mock.calls[0][0]
    expect(printedNotes).toContain('model OAuth')
    expect(printedNotes).toContain('GOOGLE_CLIENT_ID')
    expect(printedNotes).toContain('GITHUB_CLIENT_ID')
  })

  it('prints combined webAuthn+OAuth schema guidance when both are enabled', async () => {
    await handler({
      webauthn: true,
      oauth: 'google',
      createUserModel: false,
      generateAuthPages: true,
      force: false,
    })

    const printedNotes = vi.mocked(console).log.mock.calls[0][0]
    expect(printedNotes).toContain('UserCredential')
    expect(printedNotes).toContain('model OAuth')
    expect(printedNotes).toContain('GOOGLE_CLIENT_ID')
  })

  it('does not print OAuth-specific schema guidance when a fresh User model is created', async () => {
    await handler({
      webauthn: false,
      oauth: 'google',
      createUserModel: true,
      generateAuthPages: true,
      force: false,
    })

    const printedNotes = vi.mocked(console).log.mock.calls[0][0]
    // The fresh model already has the right shape (createUserModelTask wrote
    // it), so the notes shouldn't ask the user to hand-edit the schema --
    // only the env var stub, which can never be automated
    expect(printedNotes).not.toContain('You will also need to add an `OAuth`')
    expect(printedNotes).toContain('GOOGLE_CLIENT_ID')
  })
})
