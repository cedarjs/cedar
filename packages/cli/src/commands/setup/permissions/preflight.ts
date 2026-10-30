import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'

/** Shown when `web/src/auth` is missing (see `hasWebAuthFile`) */
export function authNotSetUpMessage(): string {
  return [
    'Auth is not set up in this project.',
    '',
    "Permissions build on your app's auth: a user may do what their roles,",
    'in `currentUser.roles`, may do. Set up auth first, then run this',
    'command again:',
    '',
    `  ${formatCedarCommand(['setup', 'auth', 'dbAuth'])}`,
    '',
    'Any provider works. See https://cedarjs.com/docs/authentication',
  ].join('\n')
}

/** Shown in an app with tenancy, whose setup includes permissions */
export function hasTenancyMessage(): string {
  return [
    'This app has tenancy, which includes permissions: they are in',
    'packages/permissions, and api/src/lib/permissions checks them against',
    "the user's role in the current organization.",
  ].join('\n')
}
