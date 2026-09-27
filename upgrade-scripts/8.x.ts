import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { getPaths } from '@cedarjs/project-config'

const projectPaths = getPaths()

// Auth functions live in api/src/functions, either directly or in a
// directory of their own
const apiFunctionPatterns = ['**/*.{js,ts}']

const exclude = ['**/node_modules/**', '**/dist/**']

/**
 * Reports a breaking change that the user has to act on, without aborting the
 * upgrade
 */
function warn(title: string, lines: string[]) {
  console.log(util.styleText('yellow', title) + '\n')

  for (const line of lines) {
    console.log(line + '\n')
  }
}

async function main() {
  const filesMissingChangePassword: string[] = []

  if (fs.existsSync(projectPaths.api.functions)) {
    for await (const file of fs.promises.glob(apiFunctionPatterns, {
      cwd: projectPaths.api.functions,
      exclude,
    })) {
      const filePath = path.join(projectPaths.api.functions, file)
      const content = await fs.promises.readFile(filePath, 'utf8')

      if (
        content.includes('new DbAuthHandler(') &&
        !/\bchangePassword\s*:/.test(content)
      ) {
        filesMissingChangePassword.push(
          path.relative(projectPaths.base, filePath),
        )
      }
    }
  }

  if (filesMissingChangePassword.length > 0) {
    warn('New required dbAuth option: changePassword', [
      'Found a DbAuthHandler without a `changePassword` option in: ' +
        filesMissingChangePassword.join(', '),
      '`DbAuthHandler` requires a `changePassword` option, like it does for\n' +
        '`login`, `signup`, `forgotPassword` and `resetPassword`. It configures\n' +
        'a flow where a logged in user changes their password by entering\n' +
        'their current one. Your auth function fails type-check until the\n' +
        'option is added.',
      'To keep the flow turned off, add this to the options you pass to\n' +
        '`new DbAuthHandler(...)`:\n\n' +
        '    changePassword: { enabled: false },',
      'To turn it on, add this instead, and generate the Change Password page\n' +
        'with `yarn cedar g dbAuth --skip-forgot --skip-login --skip-reset\n' +
        '--skip-signup`:\n\n' +
        '    changePassword: {\n' +
        '      // Called after the new password is saved. Return true to keep\n' +
        '      // the user logged in, false to log them out\n' +
        '      handler: (_user) => {\n' +
        '        // TODO: Let the user know their password was changed\n' +
        '        return true\n' +
        '      },\n' +
        '      // If false, the new password must differ from the current one\n' +
        '      allowReusedPassword: false,\n' +
        '    },',
      'See https://cedarjs.com/docs/auth/dbauth#changepassword for all\n' +
        'options.',
    ])
  }
}

main()
