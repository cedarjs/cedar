import fs from 'node:fs'
import path from 'node:path'

import type { AuthGeneratorCtx } from "@cedarjs/cli-helpers/auth/setupHelpers";
import { colors } from "@cedarjs/cli-helpers/colors";
import { getPaths } from "@cedarjs/cli-helpers/paths";
import { isTypeScriptProject } from "@cedarjs/cli-helpers/project";

import { addModels, functionsPath, hasModel, libPath } from './shared.js'

/**
 * The OAuth providers `cedar setup auth dbAuth --oauth` knows how to
 * configure out of the box. Anything else is served by implementing the
 * `OAuthStrategy` interface, documented at
 * https://cedarjs.com/docs/auth/dbauth#oauth-custom-strategies
 */
export const KNOWN_OAUTH_PROVIDERS = ['google', 'github'] as const

export type OAuthProviderName = (typeof KNOWN_OAUTH_PROVIDERS)[number]

function isKnownOAuthProvider(value: string): value is OAuthProviderName {
  return (KNOWN_OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Parses the comma-separated value of `--oauth` into a deduped list of
 * provider names, validating every entry against `KNOWN_OAUTH_PROVIDERS`.
 *
 * Returns an empty array when `oauth` is nullish (the flag wasn't passed).
 * Some callers pass `null` explicitly for "flag absent"; others invoke the
 * setup handler programmatically and simply omit the argument, which comes
 * through as `undefined`. Both mean "OAuth disabled".
 */
export function parseOAuthProviders(
  oauth: string | null | undefined,
): OAuthProviderName[] {
  if (oauth === null || oauth === undefined) {
    return []
  }

  const requested = oauth
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean)

  const uniqueRequested = [...new Set(requested)]

  if (uniqueRequested.length === 0) {
    throw new Error(
      '--oauth requires at least one provider, e.g. --oauth google,github',
    )
  }

  const unknownProviders = uniqueRequested.filter(
    (provider) => !isKnownOAuthProvider(provider),
  )

  if (unknownProviders.length > 0) {
    throw new Error(
      `Unknown OAuth provider(s): ${unknownProviders.join(', ')}. ` +
        `Cedar ships built-in support for ${KNOWN_OAUTH_PROVIDERS.join(
          ', ',
        )}. ` +
        'For any other provider, implement the `OAuthStrategy` interface ' +
        'from `@cedarjs/auth-dbauth-oauth` -- see ' +
        'https://cedarjs.com/docs/auth/dbauth#oauth-custom-strategies',
    )
  }

  // The filter above (with the `isKnownOAuthProvider` type guard) already
  // guarantees every entry is a known provider name
  return uniqueRequested as OAuthProviderName[]
}

// required packages to install on the api side
export const apiPackages = ['oauth4webapi@^3']

const OAUTH_MODEL = `
model OAuth {
  id               String   @id @default(uuid())
  provider         String
  providerUserId   String
  providerUsername String?
  providerEmail    String?
  userId           String
  user             User     @relation(fields: [userId], references: [id])
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([provider, providerUserId])
  @@unique([userId, provider])
}
`

export const createUserModelTask = {
  title: 'Creating model `User`...',
  task: async (ctx: AuthGeneratorCtx) => {
    const hasUserModel = await hasModel('User')

    if (hasUserModel && !ctx.force) {
      throw new Error('User model already exists')
    }

    addModels(`
model User {
  id                  String    @id @default(uuid())
  email               String    @unique
  hashedPassword      String?
  salt                String?
  resetToken          String?
  resetTokenExpiresAt DateTime?
  oauthIdentities     OAuth[]
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
${OAUTH_MODEL}`)
  },
}

export const webAuthnCreateUserModelTask = {
  title: 'Creating model `User`...',
  task: async (ctx: AuthGeneratorCtx) => {
    const hasUserModel = await hasModel('User')

    if (hasUserModel && !ctx.force) {
      throw new Error('User model already exists')
    }

    addModels(`
model User {
  id                  String    @id @default(uuid())
  email               String    @unique
  hashedPassword      String?
  salt                String?
  resetToken          String?
  resetTokenExpiresAt DateTime?
  webAuthnChallenge   String? @unique
  credentials         UserCredential[]
  oauthIdentities     OAuth[]
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model UserCredential {
  id         String  @id
  userId     String
  user       User    @relation(fields: [userId], references: [id])
  publicKey  Bytes
  transports String?
  counter    BigInt
}
${OAUTH_MODEL}`)
  },
}

const OAUTH_ENV_VAR_NAMES: Record<OAuthProviderName, string[]> = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
}

export function envVarNotes(providers: OAuthProviderName[]) {
  return [
    '',
    'Add the client id and secret for each configured OAuth provider to ' +
      'your .env file (get these from each provider’s developer console):',
    '',
    ...providers.flatMap((provider) => [
      `  # ${provider}`,
      ...OAUTH_ENV_VAR_NAMES[provider].map((name) => `  ${name}=`),
    ]),
  ]
}

function schemaNotes() {
  return [
    '',
    'You will also need to add an `OAuth` model to your Prisma schema to',
    'keep track of linked provider accounts:',
    '',
    '  model OAuth {',
    '    id               String   @id @default(uuid())',
    '    provider         String',
    '    providerUserId   String',
    '    providerUsername String?',
    '    providerEmail    String?',
    '    userId           String',
    '    user             User     @relation(fields: [userId], references: [id])',
    '    createdAt        DateTime @default(now())',
    '    updatedAt        DateTime @updatedAt',
    '',
    '    @@unique([provider, providerUserId])',
    '    @@unique([userId, provider])',
    '  }',
    '',
    'Since users can now sign up with just an OAuth provider (no password),',
    '`hashedPassword` and `salt` on your `User` model must be optional (or',
    'have a default value):',
    '',
    '  hashedPassword String?',
    '  salt           String?',
    '',
    "Don't forget to add the inverse relation to `User`:",
    '',
    '  oauthIdentities OAuth[]',
  ]
}

// any notes to print out when the job is done. Doesn't include
// `envVarNotes` -- callers append that separately since it's also needed
// when a fresh `User` model was created (schema notes aren't, in that case)
export function notes() {
  return [
    `${colors.warning('Done! But you have a little more work to do:')}\n`,
    'You will need to add a couple of fields to your User table in order',
    'to store a hashed password and salt:',
    '',
    '  model User {',
    '    id                  String  @id @default(uuid())',
    '    email               String  @unique',
    '    hashedPassword      String?   // <─┐',
    '    salt                String?   // <─┴─ add these lines',
    '    resetToken          String?   // <─┤',
    '    resetTokenExpiresAt DateTime? // <─┘',
    '  }',
    ...schemaNotes(),
    '',
    'If you expose any of your user data via GraphQL be sure to exclude',
    '`hashedPassword` and `salt` (or whatever you named them) from the',
    'SDL file that defines the fields for your user.',
    '',
    "You'll need to let Cedar know what fields you're using for your users'",
    "`id` and `username` fields. In this case we're using `id` and `email`,",
    'so update those in the `authFields` config in',
    `\`${functionsPath}/auth.js\`. This is also the place to tell Cedar if`,
    'you used a different name for the `hashedPassword`, `salt`,',
    '`resetToken` or `resetTokenExpiresAt`, fields:`',
    '',
    '  authFields: {',
    "    id: 'id',",
    "    username: 'email',",
    "    hashedPassword: 'hashedPassword',",
    "    salt: 'salt',",
    "    resetToken: 'resetToken',",
    "    resetTokenExpiresAt: 'resetTokenExpiresAt',",
    '  },',
    '',
    "To get the actual user that's logged in, take a look at `getCurrentUser()`",
    `in \`${libPath}/auth.js\`. We default it to something simple, but you may`,
    'use different names for your model or unique ID fields, in which case you',
    'need to update those calls (instructions are in the comment above the code).',
    '',
    'Finally, we created a SESSION_SECRET environment variable for you in',
    `${path.join(getPaths().base, '.env')}. This value should NOT be checked`,
    'into version control and should be unique for each environment you',
    'deploy to. If you ever need to log everyone out of your app at once',
    'change this secret to a new value and deploy. To create a new secret, run:',
    '',
    '  yarn cedar generate secret',
    '',
  ]
}

export function webAuthnOauthNotes() {
  return [
    `${colors.warning('Done! But you have a little more work to do:')}\n`,
    'You will need to add a couple of fields to your User table in order',
    'to store a hashed password, salt, reset token, and to connect it to',
    'a new UserCredential model to keep track of any devices used with',
    'WebAuthn authentication:',
    '',
    '  model User {',
    '    id                  String  @id @default(uuid())',
    '    email               String  @unique',
    '    hashedPassword      String?',
    '    salt                String?',
    '    resetToken          String?',
    '    resetTokenExpiresAt DateTime?',
    '    webAuthnChallenge   String? @unique',
    '    credentials         UserCredential[]',
    '  }',
    '',
    '  model UserCredential {',
    '    id         String  @id',
    '    userId     String',
    '    user       User    @relation(fields: [userId], references: [id])',
    '    publicKey  Bytes',
    '    transports String?',
    '    counter    BigInt',
    '  }',
    ...schemaNotes(),
    '',
    'If you expose any of your user data via GraphQL be sure to exclude',
    '`hashedPassword` and `salt` (or whatever you named them) from the',
    'SDL file that defines the fields for your user.',
    '',
    "You'll need to let Cedar know what fields you're using for your users'",
    "`id` and `username` fields. In this case we're using `id` and `email`,",
    'so update those in the `authFields` config in',
    `\`${functionsPath}/auth.js\`. This is also the place to tell Cedar if`,
    'you used a different name for the `hashedPassword`, `salt`,',
    '`resetToken` or `resetTokenExpiresAt`, fields:`',
    '',
    '  authFields: {',
    "    id: 'id',",
    "    username: 'email',",
    "    hashedPassword: 'hashedPassword',",
    "    salt: 'salt',",
    "    resetToken: 'resetToken',",
    "    resetTokenExpiresAt: 'resetTokenExpiresAt',",
    "    challenge: 'webAuthnChallenge'",
    '  },',
    '',
    "To get the actual user that's logged in, take a look at `getCurrentUser()`",
    `in \`${libPath}/auth.js\`. We default it to something simple, but you may`,
    'use different names for your model or unique ID fields, in which case you',
    'need to update those calls (instructions are in the comment above the code).',
    '',
    'Finally, we created a SESSION_SECRET environment variable for you in',
    `${path.join(getPaths().base, '.env')}. This value should NOT be checked`,
    'into version control and should be unique for each environment you',
    'deploy to. If you ever need to log everyone out of your app at once',
    'change this secret to a new value and deploy. To create a new secret, run:',
    '',
    '  yarn cedar generate secret',
    '',
  ]
}

export const noteGenerate = [
  '',
  "Need simple Login, Signup and Forgot Password pages? We've got a generator",
  'for those as well:',
  '',
  '  yarn cedar generate dbAuth',
]

/**
 * Strips the config for every OAuth provider that wasn't selected out of the
 * `auth.oauth.ts`/`auth.webAuthn.oauth.ts` templates, and drops the marker
 * comments around the config for every provider that was.
 *
 * The templates carry every known provider so there's a single source of
 * truth for the generated file's shape; this function is what turns that
 * into a file that only configures the providers the user actually asked
 * for. It's a pure string transform, so re-running setup (which always
 * starts from a fresh copy of the template) produces byte-identical output.
 *
 * Exported for testing.
 */
export function pruneOAuthProviders(
  content: string,
  providers: OAuthProviderName[],
) {
  let result = content

  for (const provider of KNOWN_OAUTH_PROVIDERS) {
    const startMarker = `// @oauth-provider:${provider}`
    const endMarker = `// @oauth-provider:${provider}:end`
    const blockPattern = new RegExp(
      `[ \\t]*${escapeRegExp(startMarker)}\\n([\\s\\S]*?)[ \\t]*${escapeRegExp(
        endMarker,
      )}\\n`,
    )

    if (providers.includes(provider)) {
      // Keep the provider's config, just drop the marker comments around it
      result = result.replace(blockPattern, '$1')
    } else {
      // Drop the provider's config entirely, and its now-unused named import
      result = result.replace(blockPattern, '')
      result = result.replace(
        new RegExp(`^[ \\t]*${provider}Provider,\\n`, 'm'),
        '',
      )
    }
  }

  return result
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rewrites the generated `functions/auth.ts` (or `.js`) in place so it only
 * configures the OAuth providers the user selected with `--oauth`. Runs
 * after `generateAuthApiFiles` has written the fresh, unpruned template, so
 * every run starts from the same source and produces the same result.
 */
export function configureOAuthProvidersTask(providers: OAuthProviderName[]) {
  return {
    title: 'Configuring selected OAuth providers...',
    task: () => {
      const ext = isTypeScriptProject() ? 'ts' : 'js'
      const authFunctionPath = path.join(
        getPaths().api.functions,
        `auth.${ext}`,
      )

      if (!fs.existsSync(authFunctionPath)) {
        return
      }

      const content = fs.readFileSync(authFunctionPath, 'utf-8')
      const prunedContent = pruneOAuthProviders(content, providers)

      if (prunedContent !== content) {
        fs.writeFileSync(authFunctionPath, prunedContent)
      }
    },
  }
}
