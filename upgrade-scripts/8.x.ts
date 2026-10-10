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

function usesTailwindCssV3() {
  const tailwindConfigExists = ['cjs', 'js', 'mjs', 'ts'].some((ext) =>
    fs.existsSync(path.join(projectPaths.web.config, `tailwind.config.${ext}`)),
  )

  const indexCssPath = path.join(projectPaths.web.src, 'index.css')
  const indexCssHasV3Directives =
    fs.existsSync(indexCssPath) &&
    fs.readFileSync(indexCssPath, 'utf8').includes('@tailwind ')

  return tailwindConfigExists || indexCssHasV3Directives
}

async function main() {
  if (usesTailwindCssV3()) {
    warn('Tailwind CSS v3 is not supported', [
      'Cedar sets up Tailwind CSS v4 with its Vite plugin, and the scaffold\n' +
        'generator writes a scaffold.css that only works with Tailwind CSS v4.\n' +
        'Your project still builds with Tailwind CSS v3, but we recommend\n' +
        'upgrading. Commit your work first, then follow these steps.',
      "1. Run Tailwind's upgrade tool from the root of your project. It moves\n" +
        'your Tailwind config into web/src/index.css and updates the class\n' +
        'names in your components:\n\n' +
        '    npx @tailwindcss/upgrade --config ./web/config/tailwind.config.cjs',
      '2. The upgrade tool adds `tailwindcss` to the root package.json. Remove\n' +
        'it from there, and remove the PostCSS packages Tailwind CSS v3 needed\n' +
        'from the web side:\n\n' +
        '    yarn remove tailwindcss\n' +
        '    yarn workspace web remove tailwindcss postcss autoprefixer',
      '3. Delete web/config/postcss.config.cjs. (If you use other PostCSS\n' +
        'plugins, only remove the `tailwindcss`, `tailwindcss/nesting` and\n' +
        '`autoprefixer` plugins from it.) Then remove the `tailwindConfig` line\n' +
        'from prettier.config.cjs.',
      '4. Set up Tailwind CSS v4 with its Vite plugin, and answer yes when\n' +
        'asked about overwriting scaffold.css:\n\n' +
        '    yarn cedar setup ui tailwindcss --force',
      'See https://tailwindcss.com/docs/upgrade-guide for all the changes in\n' +
        'Tailwind CSS v4.',
    ])
  }

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
