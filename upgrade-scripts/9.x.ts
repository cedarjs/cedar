// @dependency: oxc-parser@0.144.0
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import util from 'node:util'

import { parseSync, Visitor } from 'oxc-parser'

import { getConfig, getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

const projectPaths = getPaths()

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

function relativeToProject(filePath: string) {
  return path.relative(projectPaths.base, filePath).split(path.sep).join('/')
}

/** AST nodes, as far as this script reads them */
interface Node {
  type: string
  start: number
  [key: string]: unknown
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'start' in value &&
    typeof value.start === 'number'
  )
}

/**
 * Returns the name of a non-computed object property's key, like `babel` in
 * `{ babel: ... }` or `{ 'babel': ... }`
 */
function getPropertyName(property: Node) {
  if (property.type !== 'Property' || property.computed) {
    return undefined
  }

  const key = property.key

  if (!isNode(key)) {
    return undefined
  }

  if (key.type === 'Identifier' && typeof key.name === 'string') {
    return key.name
  }

  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value
  }

  return undefined
}

function getObjectProperties(value: unknown) {
  if (
    !isNode(value) ||
    value.type !== 'ObjectExpression' ||
    !Array.isArray(value.properties)
  ) {
    return undefined
  }

  return value.properties.filter(isNode)
}

interface EsbuildOptions {
  /** `esbuild` or `optimizeDeps.esbuildOptions` */
  option: 'esbuild' | 'optimizeDeps.esbuildOptions'
  line: number
  /** The options that are set, or `false` for `esbuild: false` */
  keys: string[] | false
  /** Whether options are spread in, so not all of them are known */
  hasSpread: boolean
}

interface ViteConfigFindings {
  /** Lines of `cedar()` calls that pass a `babel` option */
  babelOptionLines: number[]
  /**
   * Lines of `cedar()` calls whose options aren't an object literal, or spread
   * another object into it, so it isn't known whether they pass `babel`
   */
  uncheckedCedarLines: number[]
  esbuildOptions: EsbuildOptions[]
}

/**
 * Finds the parts of `code`, a Vite config, that need changes for this
 * release. `cedar` is whatever name the config imports `@cedarjs/vite`'s
 * `cedar` export, or its default export, as. Returns `null` when `code` can't
 * be parsed
 */
function checkViteConfig(
  filePath: string,
  code: string,
): ViteConfigFindings | null {
  const lineOf = (node: Node) => code.slice(0, node.start).split('\n').length
  const cedarNames = new Set<string>()
  const calls: { name: string; line: number; options: unknown }[] = []
  const findings: ViteConfigFindings = {
    babelOptionLines: [],
    uncheckedCedarLines: [],
    esbuildOptions: [],
  }

  const recordEsbuildOptions = (
    option: EsbuildOptions['option'],
    property: Node,
  ) => {
    const value = property.value
    const properties = getObjectProperties(value)

    if (isNode(value) && value.type === 'Literal' && value.value === false) {
      findings.esbuildOptions.push({
        option,
        line: lineOf(property),
        keys: false,
        hasSpread: false,
      })
    } else if (properties) {
      findings.esbuildOptions.push({
        option,
        line: lineOf(property),
        keys: properties
          .map(getPropertyName)
          .filter((name): name is string => name !== undefined),
        hasSpread: properties.some((p) => p.type === 'SpreadElement'),
      })
    } else {
      findings.esbuildOptions.push({
        option,
        line: lineOf(property),
        keys: [],
        hasSpread: true,
      })
    }
  }

  try {
    const { program, errors } = parseSync(filePath, code)

    if (errors.length > 0) {
      return null
    }

    const visitor = new Visitor({
      ImportDeclaration(node) {
        if (node.source.value !== '@cedarjs/vite') {
          return
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            cedarNames.add(specifier.local.name)
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'cedar'
          ) {
            cedarNames.add(specifier.local.name)
          }
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier') {
          calls.push({
            name: node.callee.name,
            line: lineOf(node),
            options: node.arguments[0],
          })
        }
      },
      Property(node) {
        if (!isNode(node)) {
          return
        }

        const name = getPropertyName(node)

        if (name === 'esbuild') {
          recordEsbuildOptions('esbuild', node)
        } else if (name === 'optimizeDeps') {
          for (const property of getObjectProperties(node.value) ?? []) {
            if (getPropertyName(property) === 'esbuildOptions') {
              recordEsbuildOptions('optimizeDeps.esbuildOptions', property)
            }
          }
        }
      },
    })

    visitor.visit(program)
  } catch {
    return null
  }

  for (const call of calls) {
    if (!cedarNames.has(call.name) || call.options === undefined) {
      continue
    }

    const properties = getObjectProperties(call.options)

    if (!properties) {
      findings.uncheckedCedarLines.push(call.line)
    } else if (properties.some((p) => getPropertyName(p) === 'babel')) {
      findings.babelOptionLines.push(call.line)
    } else if (properties.some((p) => p.type === 'SpreadElement')) {
      findings.uncheckedCedarLines.push(call.line)
    }
  }

  return findings
}

/**
 * The `esbuild` options Vite carries over to `oxc`. It drops the rest
 */
const esbuildOptionsCarriedOver = [
  'define',
  'exclude',
  'include',
  'jsx',
  'jsxDev',
  'jsxFactory',
  'jsxFragment',
  'jsxImportSource',
  'jsxInject',
  'jsxSideEffects',
]

/**
 * The `optimizeDeps.esbuildOptions` options Vite carries over to
 * `optimizeDeps.rolldownOptions`. It drops the rest
 */
const optimizeDepsEsbuildOptionsCarriedOver = [
  'conditions',
  'define',
  'keepNames',
  'loader',
  'mainFields',
  'minify',
  'platform',
  'preserveSymlinks',
  'resolveExtensions',
  'treeShaking',
]

function describeEsbuildOptions(
  relativePath: string,
  { option, line, keys, hasSpread }: EsbuildOptions,
) {
  const location = `  ${relativePath}:${line} ${option}`

  if (keys === false) {
    return (
      `${location}: false\n` +
      '    has no effect. Set `oxc: false` instead to turn off the\n' +
      '    TypeScript and JSX transform.'
    )
  }

  const carriedOverNames =
    option === 'esbuild'
      ? esbuildOptionsCarriedOver
      : optimizeDepsEsbuildOptionsCarriedOver
  const carriedOver = keys.filter((key) => carriedOverNames.includes(key))
  const ignored = keys.filter((key) => !carriedOverNames.includes(key))
  const lines = [location]

  if (carriedOver.length > 0) {
    lines.push(`    carried over: ${carriedOver.join(', ')}`)
  }

  if (ignored.length > 0) {
    lines.push(`    ignored: ${ignored.join(', ')}`)
  }

  if (hasSpread) {
    lines.push("    and options from a spread, which couldn't be checked")
  }

  return lines.join('\n')
}

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readWebPackageJson(): PackageJson {
  const pkgJsonPath = path.join(projectPaths.web.base, 'package.json')

  if (!fs.existsSync(pkgJsonPath)) {
    return {}
  }

  return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
}

function declares(pkg: PackageJson, name: string) {
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
}

/**
 * Returns the version of the CedarJS release being upgraded to. The upgrade
 * installs `@cedarjs/project-config` at that release's version to run this
 * script.
 */
function findTargetCedarVersion() {
  let dir = path.dirname(
    fileURLToPath(import.meta.resolve('@cedarjs/project-config')),
  )

  while (dir !== path.dirname(dir)) {
    const pkgJsonPath = path.join(dir, 'package.json')

    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))

      if (pkg.name === '@cedarjs/project-config') {
        return typeof pkg.version === 'string' ? pkg.version : undefined
      }
    }

    dir = path.dirname(dir)
  }

  return undefined
}

/**
 * Returns the `oxc-transform-react` version that `@cedarjs/vite` declares as
 * its peer dependency in `cedarVersion`, from the npm registry the user has
 * configured. `yarn cedar experimental setup-react-compiler` installs the same
 * version. Returns `undefined` when it can't be looked up.
 */
async function fetchOxcTransformReactVersion(cedarVersion: string) {
  const registry = (
    process.env.npm_config_registry || 'https://registry.npmjs.org'
  ).replace(/\/+$/, '')

  try {
    const response = await fetch(
      `${registry}/@cedarjs%2fvite/${encodeURIComponent(cedarVersion)}`,
    )

    if (!response.ok) {
      return undefined
    }

    const manifest: unknown = await response.json()

    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('peerDependencies' in manifest) ||
      typeof manifest.peerDependencies !== 'object' ||
      manifest.peerDependencies === null ||
      !('oxc-transform-react' in manifest.peerDependencies)
    ) {
      return undefined
    }

    const version = manifest.peerDependencies['oxc-transform-react']

    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/** The command that runs `action` on `packages` in the web workspace */
function webPackagesCommand(action: 'add' | 'remove', packages: string) {
  switch (getPackageManager()) {
    case 'npm':
      return action === 'add'
        ? `npm install -D ${packages} --workspace web`
        : `npm uninstall ${packages} --workspace web`
    case 'pnpm':
      return action === 'add'
        ? `pnpm --filter web add -D ${packages}`
        : `pnpm --filter web remove ${packages}`
    default:
      return action === 'add'
        ? `yarn workspace web add -D ${packages}`
        : `yarn workspace web remove ${packages}`
  }
}

async function main() {
  // Set by any check that has found something the user must fix before
  // upgrading. Checked once at the end so every problem gets reported in one
  // pass, rather than the user fixing one and rerunning to find the next
  let shouldAbort = false

  const reactCompiler = getConfig().experimental?.reactCompiler
  const webPackageJson = readWebPackageJson()

  if (
    reactCompiler?.enabled &&
    reactCompiler.lintOnly === false &&
    !declares(webPackageJson, 'oxc-transform-react')
  ) {
    const cedarVersion = findTargetCedarVersion()
    const oxcVersion = cedarVersion
      ? await fetchOxcTransformReactVersion(cedarVersion)
      : undefined

    if (oxcVersion) {
      shouldAbort = true

      const commands = [
        declares(webPackageJson, 'babel-plugin-react-compiler') &&
          webPackagesCommand('remove', 'babel-plugin-react-compiler'),
        webPackagesCommand('add', `oxc-transform-react@${oxcVersion}`),
      ].filter((command): command is string => !!command)

      fail('React Compiler needs oxc-transform-react', [
        'Cedar runs React Compiler on `oxc-transform-react`, and your web side\n' +
          "doesn't have it. Run:\n\n" +
          commands.map((command) => `    ${command}`).join('\n'),
        'Then run the upgrade again. Your current Cedar version leaves\n' +
          '`oxc-transform-react` unused, and React Compiler works as soon as\n' +
          'the upgrade is done.',
      ])
    } else {
      warn('React Compiler needs oxc-transform-react', [
        'Cedar runs React Compiler on `oxc-transform-react`, and your web side\n' +
          "doesn't have it. The version to install couldn't be looked up, so\n" +
          'your web side fails to build after the upgrade until you run:\n\n' +
          '    yarn cedar experimental setup-react-compiler --force',
      ])
    }
  }

  const viteConfigPath = projectPaths.web.viteConfig

  if (viteConfigPath && fs.existsSync(viteConfigPath)) {
    const relativePath = relativeToProject(viteConfigPath)
    const findings = checkViteConfig(
      viteConfigPath,
      fs.readFileSync(viteConfigPath, 'utf8'),
    )

    if (findings === null) {
      warn(`${relativePath} could not be checked`, [
        `${relativePath} could not be parsed, so it was not checked for a\n` +
          '`babel` option passed to `cedar()`, or for esbuild options. See\n' +
          'the CedarJS release notes for what to look for.',
      ])
    } else {
      if (findings.babelOptionLines.length > 0) {
        // Built from parts so that the upgrade CLI, which installs every
        // package this script's text imports from, doesn't install it
        const quote = "'"
        const babelImport = `import babel from ${quote}@rolldown/plugin-babel${quote}`

        warn('The `babel` option of cedar() is not supported', [
          'Your Vite config passes a `babel` option to `cedar()`:\n\n' +
            [...new Set(findings.babelOptionLines)]
              .map((line) => `  ${relativePath}:${line}`)
              .join('\n'),
          'Cedar builds your web side with Vite, which compiles TypeScript and\n' +
            "JSX without Babel, and `cedar()` doesn't take a `babel` option.\n" +
            "After the upgrade, your web side doesn't build until you remove\n" +
            'it.',
          'We recommend moving your project off Babel. For each plugin and\n' +
            'preset in the `babel` option, check whether you still need it:\n\n' +
            '  - TypeScript, JSX and modern JavaScript syntax are handled by\n' +
            '    Vite, so presets and plugins for those can go.\n' +
            '  - For React Compiler, run\n' +
            '    `yarn cedar experimental setup-react-compiler`.\n' +
            '  - For anything else, look for a Vite plugin that does the same\n' +
            '    thing.',
          "If there's a Babel plugin you can't do without, add Babel back as\n" +
            'a Vite plugin of its own:\n\n' +
            `    ${webPackagesCommand('add', '@rolldown/plugin-babel @babel/core')}\n\n` +
            `    ${babelImport}\n\n` +
            '    plugins: [\n' +
            '      cedar({ mode }),\n' +
            "      babel({ plugins: ['my-babel-plugin'] }),\n" +
            '    ]',
        ])
      }

      if (findings.uncheckedCedarLines.length > 0) {
        warn('cedar() calls that could not be checked', [
          'These `cedar()` calls get their options from a variable or a\n' +
            "spread, so it isn't known whether they pass a `babel` option:\n\n" +
            [...new Set(findings.uncheckedCedarLines)]
              .map((line) => `  ${relativePath}:${line}`)
              .join('\n'),
          "`cedar()` doesn't take a `babel` option. If one of these passes\n" +
            'it, see the CedarJS release notes for how to move off it.',
        ])
      }

      if (findings.esbuildOptions.length > 0) {
        warn('Vite options for esbuild', [
          'Vite compiles your code with Oxc and pre-bundles dependencies with\n' +
            'Rolldown, not esbuild. It still reads these esbuild options, but\n' +
            'only carries some of them over:\n\n' +
            findings.esbuildOptions
              .map((found) => describeEsbuildOptions(relativePath, found))
              .join('\n'),
          'Move the options that are carried over to `oxc` and\n' +
            '`optimizeDeps.rolldownOptions`, using their names there. The\n' +
            'ignored ones do nothing. esbuild plugins in\n' +
            '`optimizeDeps.esbuildOptions.plugins` need rewriting as Rolldown\n' +
            'plugins in `optimizeDeps.rolldownOptions.plugins`.',
          'See https://vite.dev/guide/migration for the options in Oxc and\n' +
            'Rolldown.',
        ])
      }
    }
  }

  if (shouldAbort) {
    // Set exitCode rather than calling process.exit(), so pending stdout
    // writes from the console.log calls above aren't truncated before the
    // process terminates
    process.exitCode = 1
  }
}

await main()
