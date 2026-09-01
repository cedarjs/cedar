import fs from 'node:fs'
import path from 'node:path'

import { setOutputPath, getOutputPath } from './paths.mts'
import { exec, getExecaOptions } from './util.mts'

/**
 * The `oauth4webapi` version the dbAuth-oauth package's `package.json` pins
 * as a peer dependency, kept in sync with it manually (there's no
 * `require.resolve` shortcut here -- this script runs against the test
 * project, not the framework repo).
 */
const OAUTH4WEBAPI_VERSION = '3.8.7'

/** Fixed ports the dbAuth-oauth smoke suite's global setup starts its mock providers on -- baked into the test project's `.env` here so both sides agree without a runtime handshake. */
export const OAUTH_MOCK_ISSUER_PORT = 4317
export const OAUTH_CROSSSITE_MOCK_PORT = 4318

/**
 * Adds the `OAuth` identity model to the schema, and makes `hashedPassword`
 * and `salt` on `User` optional so a provider-only account (one that never
 * sets a password) can exist.
 */
function patchSchema(schemaPath: string) {
  let schema = fs.readFileSync(schemaPath, 'utf-8')

  if (!/hashedPassword\s+String\?/.test(schema)) {
    schema = schema.replace(
      /hashedPassword(\s+)String(?!\?)/,
      'hashedPassword$1String?',
    )
  }

  if (!/\bsalt\s+String\?/.test(schema)) {
    schema = schema.replace(/\bsalt(\s+)String(?!\?)/, 'salt$1String?')
  }

  if (!/^\s*oAuth\s+OAuth\[\]/m.test(schema)) {
    schema = schema.replace(
      /(model User \{[^}]*)(\n\})/,
      '$1\n  oAuth               OAuth[]$2',
    )
  }

  if (!schema.includes('model OAuth {')) {
    schema =
      schema.trim() +
      '\n\n' +
      [
        'model OAuth {',
        '  id               Int      @id @default(autoincrement())',
        '  provider         String',
        '  providerUserId   String',
        '  providerUsername String?',
        '  providerEmail    String?',
        '  userId           String',
        '  user             User     @relation(fields: [userId], references: [id])',
        '  createdAt        DateTime @default(now())',
        '',
        '  @@unique([provider, providerUserId])',
        '  @@unique([userId, provider])',
        '}',
        '',
      ].join('\n')
  }

  fs.writeFileSync(schemaPath, schema)
}

/**
 * Adds `@cedarjs/auth-dbauth-oauth` (resolved from the tarsync'd tarball via
 * the project's existing yarn `resolutions`, same as every other `@cedarjs/*`
 * dependency) and `oauth4webapi` (a real npm dependency -- the oauth package
 * only lazy-imports it, so it has to be present in `node_modules` for that
 * import to resolve) to the api side's `package.json`.
 */
function addOAuthDependencies(apiPackageJsonPath: string) {
  const pkg = JSON.parse(fs.readFileSync(apiPackageJsonPath, 'utf-8'))

  pkg.dependencies ??= {}

  // `@cedarjs/auth-dbauth-oauth`'s version is pinned to whatever
  // `@cedarjs/auth-dbauth-api` already resolved to, so both packages come
  // from the same tarsync'd build. A silently-missing `auth-dbauth-api`
  // dependency would set `auth-dbauth-oauth` to `undefined`, which
  // `JSON.stringify` then drops entirely -- failing to add the dependency
  // without any indication why.
  if (!pkg.dependencies['@cedarjs/auth-dbauth-api']) {
    throw new Error(
      `Expected "@cedarjs/auth-dbauth-api" to already be a dependency in ${apiPackageJsonPath}, but it was missing.`,
    )
  }

  pkg.dependencies['@cedarjs/auth-dbauth-oauth'] ??=
    pkg.dependencies['@cedarjs/auth-dbauth-api']
  pkg.dependencies['oauth4webapi'] ??= OAUTH4WEBAPI_VERSION

  fs.writeFileSync(apiPackageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * Tasks that turn a regular test-project into one with dbAuth OAuth
 * configured: an `OAuth` identity model, a same-site OIDC provider (`mock`)
 * and a cross-site `form_post` provider (`crosssite`), both pointed at the
 * mock providers the `dbauth-oauth` Playwright suite's global setup starts
 * on fixed ports, plus login-page buttons for each.
 *
 * Mirrors `fragmentsTasks` in `fragments-tasks.mts`: patches an
 * already-built test project on the fly rather than touching
 * `__fixtures__/test-project`, so the checked-in fixture stays untouched and
 * every other smoke suite that shares it is unaffected.
 */
export function oauthTasks(outputPath: string) {
  setOutputPath(outputPath)

  return [
    {
      title: 'Add the OAuth identity model to the Prisma schema',
      task: async () => {
        patchSchema(path.join(getOutputPath(), 'api', 'db', 'schema.prisma'))
      },
    },
    {
      title:
        'Add @cedarjs/auth-dbauth-oauth and oauth4webapi as api dependencies',
      task: async () => {
        addOAuthDependencies(path.join(getOutputPath(), 'api', 'package.json'))

        return exec('yarn', ['install'], getExecaOptions(getOutputPath()))
      },
    },
    {
      // `yarn install` above can leave the api workspace's `node_modules`
      // linking stale relative to the previously generated Prisma client
      // (observed as `ERR_MODULE_NOT_FOUND` for
      // `api/db/generated/prisma/client.mts` when `cedar dev` starts) --
      // regenerating explicitly avoids depending on `migrate dev` happening
      // to trigger it as a side effect.
      title:
        'Regenerate the Prisma client after installing the OAuth dependency',
      task: async () => {
        return exec(
          'yarn cedar prisma generate',
          [],
          getExecaOptions(getOutputPath()),
        )
      },
    },
    {
      title: 'Run the OAuth identity model migration',
      task: async () => {
        return exec(
          'yarn cedar prisma migrate dev --name add_oauth_identity',
          [],
          getExecaOptions(getOutputPath()),
        )
      },
    },
    {
      title:
        'Copy the OAuth-enabled auth function and login page from templates',
      task: () => {
        const templatesPath = path.join(
          import.meta.dirname,
          'templates',
          'oauth-smoke',
        )

        fs.copyFileSync(
          path.join(templatesPath, 'api', 'auth.ts'),
          path.join(getOutputPath(), 'api', 'src', 'functions', 'auth.ts'),
        )
        fs.copyFileSync(
          path.join(templatesPath, 'web', 'LoginPage.tsx'),
          path.join(
            getOutputPath(),
            'web',
            'src',
            'pages',
            'LoginPage',
            'LoginPage.tsx',
          ),
        )
      },
    },
    {
      title: 'Set the OAuth mock-provider env vars',
      task: () => {
        const envPath = path.join(getOutputPath(), '.env')
        const existing = fs.existsSync(envPath)
          ? fs.readFileSync(envPath, 'utf-8').replace(/\n?$/, '\n')
          : ''

        const oauthEnv = [
          `OAUTH_MOCK_ISSUER=http://localhost:${OAUTH_MOCK_ISSUER_PORT}`,
          'OAUTH_MOCK_CLIENT_ID=mock-client-id',
          'OAUTH_MOCK_CLIENT_SECRET=mock-client-secret',
          `OAUTH_CROSSSITE_AUTHORIZE_URL=http://127.0.0.1:${OAUTH_CROSSSITE_MOCK_PORT}/authorize`,
        ].join('\n')

        fs.writeFileSync(envPath, `${existing}${oauthEnv}\n`)
      },
    },
  ]
}
