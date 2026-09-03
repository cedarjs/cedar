import fs from 'node:fs'
import path from 'node:path'

const WEB_AUTH_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx']

/**
 * Every auth provider's setup command writes `web/src/auth`, and nothing else
 * does, so its presence is what tells us auth is set up whichever provider an
 * app uses. `api/src/lib/auth` is not that signal: a new app has one before
 * auth is set up at all.
 */
export function hasWebAuthFile(webSrcPath: string): boolean {
  return WEB_AUTH_EXTENSIONS.some((extension) =>
    fs.existsSync(path.join(webSrcPath, `auth.${extension}`)),
  )
}

/**
 * Shown when `web/src/auth` is missing. Checked first because it needs
 * nothing but the filesystem: resolving the Prisma schema loads the project's
 * Prisma config, which a project that has never installed dependencies
 * cannot do.
 */
export const AUTH_NOT_SET_UP_MESSAGE = [
  'Auth is not set up in this project.',
  '',
  "Tenancy builds on your app's auth: it adds memberships to",
  '`getCurrentUser`, and resolves the current organization from the',
  "signed-in user's memberships. Set up auth first, then run this command",
  'again:',
  '',
  '  yarn cedar setup auth dbAuth',
  '',
  'Any provider works. See https://cedarjs.com/docs/authentication',
].join('\n')

/**
 * Shown when the schema has no `User` model. dbAuth adds one; providers that
 * authenticate against an external service leave it to the app.
 */
export function noUserModelMessage(schemaPath: string): string {
  return [
    `No \`User\` model found in ${schemaPath}.`,
    '',
    "Tenancy hangs memberships off your app's `User` model, so it needs one",
    'before it can add `Organization` and `Membership`.',
    '',
    'dbAuth adds this model for you. Providers that authenticate against an',
    'external service leave it to you: give `User` its own id and store the',
    "provider's id in a column beside it, so memberships keep working if you",
    'switch providers or add a second one.',
    '',
    'Add a model like this one, run `yarn cedar prisma migrate dev`, then',
    'run this command again:',
    '',
    '  model User {',
    '    id    String @id @default(cuid())',
    '    email String @unique',
    '  }',
  ].join('\n')
}
