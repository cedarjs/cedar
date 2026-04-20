import { fs as memfs, vol } from 'memfs'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import { getConfig, getRawConfig } from '../config'

vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

const cedarCwd = process.env.CEDAR_CWD

beforeEach(() => {
  process.env.CEDAR_CWD = '/cedar-app'
})

afterEach(() => {
  process.env.CEDAR_CWD = cedarCwd
})

describe('getRawConfig', () => {
  it('returns nothing for an empty config', () => {
    vol.fromJSON({ 'cedar.toml': '' }, '/cedar-app')

    const config = getRawConfig()

    expect(config).toMatchInlineSnapshot(`{}`)
  })

  it('returns only the defined values', () => {
    vol.fromJSON({ 'cedar.toml': '[web]\nport = 8888' }, '/cedar-app')

    const config = getRawConfig()

    expect(config).toMatchInlineSnapshot(`
      {
        "web": {
          "port": 8888,
        },
      }
    `)
  })
})

describe('getConfig', () => {
  it('returns a default config', () => {
    vol.fromJSON({ 'cedar.toml': '' }, '/cedar-app')

    const config = getConfig()

    expect(config).toMatchInlineSnapshot(`
      {
        "api": {
          "debugPort": undefined,
          "path": "./api",
          "port": 8911,
          "prismaConfig": "./api/prisma.config.cjs",
          "serverConfig": "./api/server.config.js",
          "target": "node",
          "title": "Cedar App",
        },
        "browser": {
          "open": false,
        },
        "eslintLegacyConfigWarning": true,
        "experimental": {
          "cli": {
            "autoInstall": true,
            "plugins": [
              {
                "package": "@cedarjs/cli-storybook-vite",
              },
              {
                "package": "@cedarjs/cli-data-migrate",
              },
            ],
          },
          "gqlorm": {
            "enabled": false,
            "membershipModel": "Membership",
            "membershipOrganizationField": "organizationId",
            "membershipUserField": "userId",
            "organizationModel": "Organization",
          },
          "opentelemetry": {
            "enabled": false,
            "wrapApi": true,
          },
          "packagesWorkspace": {
            "enabled": false,
          },
          "reactCompiler": {
            "enabled": false,
            "lintOnly": false,
          },
          "realtime": {
            "enabled": false,
          },
          "rsc": {
            "enabled": false,
          },
          "streamingSsr": {
            "enabled": false,
          },
          "useSDLCodeGenForGraphQLTypes": false,
        },
        "generate": {
          "nestScaffoldByModel": true,
          "stories": true,
          "tests": true,
        },
        "graphql": {
          "fragments": false,
          "includeScalars": {
            "File": true,
          },
          "trustedDocuments": false,
        },
        "notifications": {
          "versionUpdates": [],
        },
        "studio": {
          "basePort": 4318,
          "graphiql": {
            "authImpersonation": {
              "authProvider": undefined,
              "email": undefined,
              "jwtSecret": "secret",
              "userId": undefined,
            },
          },
        },
        "web": {
          "a11y": true,
          "apiUrl": "/.redwood/functions",
          "fastRefresh": true,
          "includeEnvironmentVariables": [],
          "path": "./web",
          "port": 8910,
          "sourceMap": false,
          "target": "browser",
          "title": "Cedar App",
        },
      }
    `)
  })

  it('merges configs', () => {
    vol.fromJSON({ 'cedar.toml': '[web]\nport = 8888' }, '/cedar-app')

    const config = getConfig()

    expect(config.web.port).toEqual(8888)
  })

  describe('with studio configs', () => {
    it('merges studio configs with dbAuth impersonation', () => {
      vol.fromJSON(
        {
          'cedar.toml': `
            [web]
              port = 8888
            [studio]
              [studio.graphiql]
                [studio.graphiql.authImpersonation]
                  authProvider = "dbAuth"
                  email = "user@example.com"
                  userId = "1"
            `,
        },
        '/cedar-app',
      )
      const config = getConfig()
      expect(config.studio.graphiql?.authImpersonation?.authProvider).toEqual(
        'dbAuth',
      )
      expect(config.studio.graphiql?.authImpersonation?.email).toEqual(
        'user@example.com',
      )
      expect(config.studio.graphiql?.authImpersonation?.userId).toEqual('1')
    })

    it('merges studio configs with supabase impersonation', () => {
      vol.fromJSON(
        {
          'cedar.toml': `
            [web]
              port = 8888
            [studio]
              [studio.graphiql]
                [studio.graphiql.authImpersonation]
                  authProvider = "supabase"
                  email = "supauser@example.com"
                  jwtSecret = "supa-secret"
                  userId = "1"
            `,
        },
        '/cedar-app',
      )

      const config = getConfig()

      expect(config.studio.graphiql?.authImpersonation?.authProvider).toEqual(
        'supabase',
      )
      expect(config.studio.graphiql?.authImpersonation?.email).toEqual(
        'supauser@example.com',
      )
      expect(config.studio.graphiql?.authImpersonation?.userId).toEqual('1')
      expect(config.studio.graphiql?.authImpersonation?.jwtSecret).toEqual(
        'supa-secret',
      )
    })
  })

  describe('with graphql configs', () => {
    describe('sets defaults', () => {
      it('sets trustedDocuments to false', () => {
        vol.fromJSON({ 'cedar.toml': '[web]\nport = 8888' }, '/cedar-app')

        const config = getConfig()

        expect(config.graphql.trustedDocuments).toEqual(false)
        expect(config.graphql.fragments).toEqual(false)
      })
    })

    it('merges graphql configs', () => {
      vol.fromJSON(
        {
          'cedar.toml': `
            [web]
              port = 8888
            [graphql]
              fragments = true
              trustedDocuments = true
            `,
        },
        '/cedar-app',
      )
      const config = getConfig()
      expect(config.graphql.trustedDocuments).toEqual(true)
      expect(config.graphql.fragments).toEqual(true)
    })
  })

  it('throws an error when the config file has the wrong format', () => {
    vol.fromJSON({ 'cedar.toml': '-invalid content-' }, '/cedar-app')
    expect(() => getConfig()).toThrow(
      /Could not parse .+cedar.toml.+ Error: Invalid TOML/,
    )
  })

  it('interpolates environment variables correctly', () => {
    process.env.API_URL = '/bazinga'
    process.env.APP_ENV = 'staging'
    process.env.API_PORT = '8915'

    vol.fromJSON(
      {
        'cedar.toml': `
          [web]
            title = "App running on \${APP_ENV}"
            port = "\${PORT:8910}"
            apiUrl = "\${API_URL:/.redwood/functions}" # you can customise graphql and dbauth urls individually too: see https://cedarjs.com/docs/app-configuration-redwood-toml#api-paths
            includeEnvironmentVariables = [] # any ENV vars that should be available to the web side, see https://cedarjs.com/docs/environment-variables#web
          [api]
            port = "\${API_PORT:8911}"
          [browser]
            open = true
          `,
      },
      '/cedar-app',
    )
    const config = getConfig()

    // Fallsback to the default if env var not supplied
    expect(config.web.port).toBe('8910')

    // Uses the env var if supplied
    expect(config.web.apiUrl).toBe('/bazinga')
    expect(config.web.title).toBe('App running on staging')
    // env vars are always strings
    expect(config.api.port).toBe('8915')

    delete process.env.API_URL
    delete process.env.APP_ENV
    delete process.env.API_PORT
  })
})
