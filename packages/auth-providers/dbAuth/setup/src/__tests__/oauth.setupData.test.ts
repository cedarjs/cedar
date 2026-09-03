import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, vi } from 'vitest'

// `../oauth.setupData` pulls in `./shared.js`, which calls `getPaths()` at
// module load time. Stub `@cedarjs/cli-helpers` the same way
// `setupData.test.ts` does so that import doesn't need a real Cedar project
// on disk -- none of the functions under test here (`parseOAuthProviders`,
// `pruneOAuthProviders`) touch paths at all.
vi.mock('@cedarjs/cli-helpers/project', () => {
  return {
    getGraphqlPath: () => '/cedar-app/api/src/functions/graphql.ts',
    addEnvVarTask: () => {},
    isTypeScriptProject: () => true,
  }
})

vi.mock('@cedarjs/cli-helpers/paths', () => {
  return {
    getPaths: () => ({
      base: '/cedar-app',
      api: {
        lib: '/cedar-app/api/src/lib',
        functions: '/cedar-app/api/src/functions',
        prismaConfig: '/cedar-app/api/prisma.config.cjs',
      },
    }),
  }
})

vi.mock('@cedarjs/cli-helpers/colors', () => {
  return {
    colors: {
      error: (str: string) => str,
      warning: (str: string) => str,
      green: (str: string) => str,
      info: (str: string) => str,
      bold: (str: string) => str,
      underline: (str: string) => str,
    },
  }
})

import type { OAuthProviderName } from '../oauth.setupData'
import { parseOAuthProviders, pruneOAuthProviders } from '../oauth.setupData'

// The real, unpruned template content -- these are read straight off disk
// (no mocking needed) since template *selection* (which file wins for a
// given webAuthn/oauth combination) is already covered by
// `packages/cli-helpers/src/auth/__tests__/authFiles.test.ts`. This file
// only tests what happens to that content once a provider list is applied.
const templatesDir = path.resolve(__dirname, '../templates/api/functions')

const oauthTemplate = fs.readFileSync(
  path.join(templatesDir, 'auth.oauth.ts.template'),
  'utf-8',
)
const webAuthnOauthTemplate = fs.readFileSync(
  path.join(templatesDir, 'auth.webAuthn.oauth.ts.template'),
  'utf-8',
)

function render(template: string, providers: OAuthProviderName[]) {
  return pruneOAuthProviders(template, providers)
}

describe('parseOAuthProviders', () => {
  it('returns an empty list when the flag was not passed', () => {
    expect(parseOAuthProviders(null)).toEqual([])
  })

  it('returns an empty list when the argument is omitted entirely', () => {
    expect(parseOAuthProviders(undefined)).toEqual([])
  })

  it('parses a comma-separated list', () => {
    expect(parseOAuthProviders('google,github')).toEqual(['google', 'github'])
  })

  it('trims whitespace and lower-cases provider names', () => {
    expect(parseOAuthProviders(' Google , GitHub ')).toEqual([
      'google',
      'github',
    ])
  })

  it('dedupes repeated providers', () => {
    expect(parseOAuthProviders('google,google')).toEqual(['google'])
  })

  it('throws for an empty value', () => {
    expect(() => parseOAuthProviders('')).toThrow(/at least one provider/)
  })

  it('throws for unknown providers, naming the `OAuthStrategy` interface', () => {
    expect(() => parseOAuthProviders('facebook')).toThrow(
      /implement the `OAuthStrategy` interface/,
    )
    expect(() => parseOAuthProviders('facebook')).toThrow(
      /@cedarjs\/auth-dbauth-oauth/,
    )
  })
})

describe('generated auth function -- oauth template', () => {
  it('matches snapshot for --oauth google', () => {
    const content = render(oauthTemplate, ['google'])

    expect(content).toMatchSnapshot()
    expect(content).toContain('googleProvider')
    expect(content).not.toContain('githubProvider')
    expect(content).not.toContain('@oauth-provider')
  })

  it('matches snapshot for --oauth github', () => {
    const content = render(oauthTemplate, ['github'])

    expect(content).toMatchSnapshot()
    expect(content).toContain('githubProvider')
    expect(content).not.toContain('googleProvider')
    expect(content).not.toContain('@oauth-provider')
  })

  it('matches snapshot for --oauth google,github', () => {
    const content = render(oauthTemplate, ['google', 'github'])

    expect(content).toMatchSnapshot()
    expect(content).toContain('googleProvider')
    expect(content).toContain('githubProvider')
    expect(content).not.toContain('@oauth-provider')
  })

  it('matches snapshot for --webauthn --oauth google,github (combined variant)', () => {
    const content = render(webAuthnOauthTemplate, ['google', 'github'])

    expect(content).toMatchSnapshot()
    expect(content).toContain('credentialModelAccessor')
    expect(content).toContain('googleProvider')
    expect(content).toContain('githubProvider')
  })

  it('the base (non-oauth) template has no OAuth wiring to prune', () => {
    const baseTemplate = fs.readFileSync(
      path.join(templatesDir, 'auth.ts.template'),
      'utf-8',
    )

    expect(baseTemplate).not.toContain('OAuthHandler')
    expect(baseTemplate).not.toContain('@oauth-provider')
  })

  it('the webAuthn-only template has no OAuth wiring to prune', () => {
    const webAuthnTemplate = fs.readFileSync(
      path.join(templatesDir, 'auth.webAuthn.ts.template'),
      'utf-8',
    )

    expect(webAuthnTemplate).not.toContain('OAuthHandler')
    expect(webAuthnTemplate).toContain('credentialModelAccessor')
  })
})

describe('idempotency', () => {
  it('rendering from the pristine template twice produces byte-identical output', () => {
    const run1 = render(webAuthnOauthTemplate, ['google', 'github'])
    const run2 = render(webAuthnOauthTemplate, ['google', 'github'])

    expect(run1).toEqual(run2)
  })

  it('pruning already-pruned content again is a no-op', () => {
    const pruned = render(oauthTemplate, ['google'])

    expect(pruneOAuthProviders(pruned, ['google'])).toEqual(pruned)
  })
})
