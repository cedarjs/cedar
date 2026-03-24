import path from 'path'

import { describe, it, expect, afterEach, beforeEach } from 'vitest'

import { getConfig, getRawConfig, clearConfigCache } from '../config'

describe('getRawConfig', () => {
  it('returns nothing for an empty config', () => {
    const config = getRawConfig(
      path.join(__dirname, './fixtures/cedar.empty.toml'),
    )
    expect(config).toMatchInlineSnapshot(`{}`)
  })

  it('returns only the defined values', () => {
    const config = getRawConfig(path.join(__dirname, './fixtures/cedar.toml'))
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
  const cedarCwd = process.env.CEDAR_CWD

  beforeEach(() => {
    clearConfigCache()
  })

  afterEach(() => {
    process.env.CEDAR_CWD = cedarCwd
  })

  it('returns a default config', () => {
    process.env.CEDAR_CWD = path.join(__dirname, './fixtures/cedar.empty.toml')
    const config = getConfig()
    expect(config).toMatchInlineSnapshot(`
      {
        "api": {
          "debugPort": 18911,
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
    process.env.CEDAR_CWD = path.join(__dirname, './fixtures/cedar.toml')
    const config = getConfig()
    expect(config.web.port).toEqual(8888)
  })

  describe('with studio configs', () => {
    it('merges studio configs with dbAuth impersonation', () => {
      process.env.CEDAR_CWD = path.join(
        __dirname,
        './fixtures/cedar.studio.dbauth.toml',
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
      process.env.CEDAR_CWD = path.join(
        __dirname,
        './fixtures/cedar.studio.supabase.toml',
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
        process.env.CEDAR_CWD = path.join(__dirname, './fixtures/cedar.toml')
        const config = getConfig()
        expect(config.graphql.trustedDocuments).toEqual(false)
        expect(config.graphql.fragments).toEqual(false)
      })
    })

    it('merges graphql configs', () => {
      process.env.CEDAR_CWD = path.join(
        __dirname,
        './fixtures/cedar.graphql.toml',
      )
      const config = getConfig()
      expect(config.graphql.trustedDocuments).toEqual(true)
      expect(config.graphql.fragments).toEqual(true)
    })
  })

  it('throws an error when given a bad config path', () => {
    process.env.CEDAR_CWD = path.join(__dirname, './fixtures/fake_cedar.toml')
    const runGetConfig = () => {
      getConfig()
    }
    expect(runGetConfig).toThrow(
      /Could not parse .+fake_cedar.toml.+ Error: ENOENT: no such file or directory, open .+fake_cedar.toml./,
    )
  })

  it('interpolates environment variables correctly', () => {
    process.env.API_URL = '/bazinga'
    process.env.APP_ENV = 'staging'

    process.env.CEDAR_CWD = path.join(
      __dirname,
      './fixtures/cedar.withEnv.toml',
    )
    const config = getConfig()

    // Fallsback to the default if env var not supplied
    expect(config.web.port).toBe('8910') // remember env vars have to be strings

    // Uses the env var if supplied
    expect(config.web.apiUrl).toBe('/bazinga')
    expect(config.web.title).toBe('App running on staging')

    delete process.env.API_URL
    delete process.env.APP_ENV
  })
})
