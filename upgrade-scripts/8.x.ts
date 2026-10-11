// @dependency: oxc-parser@0.144.0
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { parseSync, Visitor } from 'oxc-parser'

import { getPaths } from '@cedarjs/project-config'

const projectPaths = getPaths()

// Auth functions live in api/src/functions, either directly or in a
// directory of their own
const apiFunctionPatterns = ['**/*.{js,ts}']

const exclude = ['**/node_modules/**', '**/dist/**']

/**
 * Reports a problem that blocks the upgrade. Callers must also set
 * `shouldAbort`, which makes the script exit non-zero.
 *
 * Writes to stdout, even though this is an error. The CLI reads a failed
 * script's stdout into the message it shows the user and only surfaces stderr
 * under `--verbose`, so anything written to stderr here would be invisible in
 * the default output.
 */
function fail(title: string, lines: string[]) {
  console.log(util.styleText('red', title) + '\n')

  for (const line of lines) {
    console.log(line + '\n')
  }
}

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

/**
 * Returns `undefined` for projects that don't use Tailwind CSS v3. For projects
 * that do, returns the path to their Tailwind config file, relative to the
 * project root, or `null` if only index.css shows that they use v3
 */
function findTailwindCssV3Config() {
  const indexCssPath = path.join(projectPaths.web.src, 'index.css')
  const indexCss = fs.existsSync(indexCssPath)
    ? fs.readFileSync(indexCssPath, 'utf8')
    : ''

  // Tailwind CSS v4 projects import Tailwind in their CSS, even when they keep
  // a JavaScript config file around through `@config`
  if (/@import\s+['"]tailwindcss['"]/.test(indexCss)) {
    return undefined
  }

  const tailwindConfigPath = ['cjs', 'js', 'mjs', 'ts']
    .map((ext) => path.join(projectPaths.web.config, `tailwind.config.${ext}`))
    .find((configPath) => fs.existsSync(configPath))

  if (tailwindConfigPath) {
    return path
      .relative(projectPaths.base, tailwindConfigPath)
      .split(path.sep)
      .join('/')
  }

  return indexCss.includes('@tailwind ') ? null : undefined
}

// The props <Set>, <PrivateSet> and <Private> use themselves. Wrapper
// components only get `children`
const setOwnProps = [
  'wrap',
  'private',
  'unauthenticated',
  'roles',
  'prerender',
  'whileLoadingAuth',
  'whileLoadingPage',
  'children',
  'key',
]

const setComponents = ['Set', 'PrivateSet', 'Private']

// Routes live in web/src/Routes.{jsx,tsx}, but Sets can be written in other
// files too
const webSrcPatterns = ['**/*.{js,jsx,ts,tsx}']

interface SetWithWrapperProps {
  file: string
  line: number
  setName: string
  wrappers: string
  props: string[]
}

/**
 * Finds every <Set>, <PrivateSet> and <Private> in `code` that has props other
 * than the Set's own props. Returns `null` when `code` can't be parsed
 */
function findSetsWithWrapperPropsInFile(
  filePath: string,
  code: string,
): Omit<SetWithWrapperProps, 'file'>[] | null {
  const sets: Omit<SetWithWrapperProps, 'file'>[] = []

  try {
    const { program, errors } = parseSync(filePath, code)

    if (errors.length > 0) {
      return null
    }

    const visitor = new Visitor({
      JSXOpeningElement(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          !setComponents.includes(node.name.name)
        ) {
          return
        }

        let wrappers = '(none)'
        const props: string[] = []

        for (const attribute of node.attributes) {
          // A spread can carry props for the wrappers, and which props it
          // holds isn't known statically, so it's always reported
          if (attribute.type === 'JSXSpreadAttribute') {
            props.push(
              `{...${code.slice(attribute.argument.start, attribute.argument.end)}}`,
            )
            continue
          }

          if (
            attribute.type !== 'JSXAttribute' ||
            attribute.name.type !== 'JSXIdentifier'
          ) {
            continue
          }

          if (attribute.name.name === 'wrap') {
            const value = attribute.value

            wrappers =
              value?.type === 'JSXExpressionContainer'
                ? code.slice(value.expression.start, value.expression.end)
                : '(unknown)'
          } else if (!setOwnProps.includes(attribute.name.name)) {
            props.push(attribute.name.name)
          }
        }

        if (props.length > 0) {
          sets.push({
            line: code.slice(0, node.start).split('\n').length,
            setName: node.name.name,
            wrappers,
            props,
          })
        }
      },
    })

    visitor.visit(program)
  } catch {
    return null
  }

  return sets
}

async function findSetsWithWrapperProps() {
  const sets: SetWithWrapperProps[] = []
  // Files with a Set that couldn't be parsed, so they couldn't be checked
  const unparsedFiles: string[] = []

  if (!fs.existsSync(projectPaths.web.src)) {
    return { sets, unparsedFiles }
  }

  for await (const file of fs.promises.glob(webSrcPatterns, {
    cwd: projectPaths.web.src,
    exclude,
  })) {
    const filePath = path.join(projectPaths.web.src, file)
    const code = await fs.promises.readFile(filePath, 'utf8')

    if (!/<(Set|PrivateSet|Private)\b/.test(code)) {
      continue
    }

    const relativePath = path
      .relative(projectPaths.base, filePath)
      .split(path.sep)
      .join('/')
    const setsInFile = findSetsWithWrapperPropsInFile(filePath, code)

    if (setsInFile === null) {
      unparsedFiles.push(relativePath)
      continue
    }

    for (const set of setsInFile) {
      sets.push({ file: relativePath, ...set })
    }
  }

  return {
    sets: sets.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    unparsedFiles: unparsedFiles.sort(),
  }
}

async function main() {
  // Set by any check that has found something the user must fix before
  // upgrading. Checked once at the end so every problem gets reported in one
  // pass, rather than the user fixing one and rerunning to find the next
  let shouldAbort = false

  const { sets: setsWithWrapperProps, unparsedFiles } =
    await findSetsWithWrapperProps()

  if (unparsedFiles.length > 0) {
    warn('Files with <Set> components that could not be checked', [
      'These files contain <Set>, <PrivateSet> or <Private>, but they could\n' +
        'not be parsed, so they were not checked for props meant for wrapper\n' +
        'components:\n\n' +
        unparsedFiles.map((file) => `  ${file}`).join('\n'),
      'Wrapper components only get `children`. Check the Sets in these files\n' +
        'by hand. For a Set with props other than `wrap`, `private`,\n' +
        '`unauthenticated`, `roles`, `prerender`, `whileLoadingAuth` and\n' +
        '`whileLoadingPage`, create a layout component that renders the\n' +
        'wrapper with those props, and use it in `wrap` instead.',
    ])
  }

  if (setsWithWrapperProps.length > 0) {
    shouldAbort = true

    fail('<Set> props for wrapper components', [
      'Found <Set>, <PrivateSet> or <Private> components with props that are\n' +
        'meant for their wrapper components:\n\n' +
        setsWithWrapperProps
          .map(
            (set) =>
              `  ${set.file}:${set.line} <${set.setName}>\n` +
              `    wrap: ${set.wrappers}\n` +
              `    props: ${set.props.join(', ')}`,
          )
          .join('\n'),
      'Wrapper components only get `children`. For each of these Sets,\n' +
        'create a layout component that renders the wrapper with the props\n' +
        'it needs, and use that layout component in `wrap` instead. This is\n' +
        'what the scaffold generator does:\n\n' +
        '    function PostsScaffoldLayout({ children }) {\n' +
        '      return (\n' +
        '        <ScaffoldLayout\n' +
        '          title="Posts"\n' +
        '          titleTo="posts"\n' +
        '          buttonLabel="New Post"\n' +
        '          buttonTo="newPost"\n' +
        '        >\n' +
        '          {children}\n' +
        '        </ScaffoldLayout>\n' +
        '      )\n' +
        '    }\n\n' +
        '    <Set wrap={PostsScaffoldLayout}>',
      'Then remove the props from the Set. This works with your current\n' +
        'Cedar version too, so make the change before you upgrade, and run\n' +
        'the upgrade again.',
    ])
  }

  const tailwindCssV3Config = findTailwindCssV3Config()

  if (tailwindCssV3Config !== undefined) {
    const upgradeCommand = tailwindCssV3Config
      ? `npx @tailwindcss/upgrade --config ./${tailwindCssV3Config}`
      : 'npx @tailwindcss/upgrade'

    warn('Tailwind CSS v3 is not supported', [
      'Cedar sets up Tailwind CSS v4 with its Vite plugin, and the scaffold\n' +
        'generator writes a scaffold.css that only works with Tailwind CSS v4.\n' +
        'Your project still builds with Tailwind CSS v3, but we recommend\n' +
        'upgrading. Commit your work first, then follow these steps.',
      "1. Run Tailwind's upgrade tool from the root of your project. It moves\n" +
        'your Tailwind config into web/src/index.css and updates the class\n' +
        'names in your components:\n\n' +
        `    ${upgradeCommand}`,
      '2. The upgrade tool adds `tailwindcss` to the root package.json. Remove\n' +
        'it from there, and remove the PostCSS packages Tailwind CSS v3 needed\n' +
        'from the web side:\n\n' +
        '    yarn remove tailwindcss\n' +
        '    yarn workspace web remove tailwindcss postcss autoprefixer\n\n' +
        'If you use other PostCSS plugins (see step 3), leave `postcss` out of\n' +
        'the last command.',
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

  if (shouldAbort) {
    // Set exitCode and return rather than calling process.exit() directly,
    // so pending stdout writes from the console.log calls above aren't
    // truncated before the process terminates.
    process.exitCode = 1
    return
  }
}

main()
