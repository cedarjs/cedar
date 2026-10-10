import fs from 'node:fs'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import execa from 'execa'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import {
  addRootPackages,
  addWorkspacePackages,
} from '@cedarjs/cli-helpers/packageManager/packages'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, usingVSCode } from '../../../../lib/index.js'
import { insertPluginsBeforeCedar } from '../../deploy/helpers/index.js'

const tailwindImport = "@import 'tailwindcss';"

const tailwindImportRegExp = /@import\s+['"]tailwindcss['"]/

const tailwindImportAndNotes = [
  '/**',
  ' * START --- SETUP TAILWINDCSS EDIT',
  ' *',
  ` * \`${formatCedarCommand(['setup', 'ui', 'tailwindcss'])}\` placed this import here`,
  " * to inject Tailwind's styles into your CSS.",
  ' * For more information, see: https://tailwindcss.com/docs/installation',
  ' */',
  tailwindImport,
  '/**',
  ' * END --- SETUP TAILWINDCSS EDIT',
  ' */\n',
]

const recommendedVSCodeExtensions: string[] = ['bradlc.vscode-tailwindcss']

const recommendationTexts: Record<string, string> = {
  'bradlc.vscode-tailwindcss': terminalLink(
    'Tailwind CSS IntelliSense',
    'https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss',
  ),
}

async function recommendExtensionsToInstall() {
  if (!usingVSCode()) {
    return
  }

  let recommendations: string[] = []

  try {
    const { stdout } = await execa('code', ['--list-extensions'])
    const installedExtensions = stdout.split('\n').map((ext) => ext.trim())
    recommendations = recommendedVSCodeExtensions.filter(
      (ext) => !installedExtensions.includes(ext),
    )
  } catch {
    // `code` probably not in PATH so can't check for installed extensions.
    // We'll just recommend all extensions
    recommendations = recommendedVSCodeExtensions
  }

  if (recommendations.length > 0) {
    console.log()
    console.log(
      c.info(
        'For the best experience we recommend that you install the following ' +
          (recommendations.length === 1 ? 'extension:' : 'extensions:'),
      ),
    )

    recommendations.forEach((extension) => {
      console.log(c.info('  ' + recommendationTexts[extension]))
    })
  }
}

export const handler = async ({
  force,
  install,
}: {
  force: boolean
  install: boolean
}) => {
  recordTelemetryAttributes({
    command: 'setup ui tailwindcss',
    force,
    install,
  })
  const rwPaths = getPaths()

  const projectPackages = ['prettier-plugin-tailwindcss@^0.8.0']

  const webWorkspacePackages = [
    'tailwindcss@^4.3.3',
    '@tailwindcss/vite@^4.3.3',
  ]

  const tasks = new Listr(
    [
      {
        title: 'Installing project-wide packages...',
        skip: () => !install,
        task: () => {
          return new Listr(
            [
              {
                title: `Install ${projectPackages.join(', ')}`,
                task: async () => {
                  await addRootPackages(projectPackages, {
                    cwd: rwPaths.base,
                    dev: true,
                  })
                },
              },
            ],
            { rendererOptions: { collapseSubtasks: false } },
          )
        },
      },
      {
        title: 'Installing web side packages...',
        skip: () => !install,
        task: () => {
          return new Listr(
            [
              {
                title: `Install ${webWorkspacePackages.join(', ')}`,
                task: async () => {
                  await addWorkspacePackages('web', webWorkspacePackages, {
                    cwd: rwPaths.base,
                    env: {
                      // For some reason yarn started installing deprecated
                      // typescript types when installing tailwind. This
                      // prevents it from happening. (yarn-only env var.)
                      YARN_TS_ENABLE_AUTO_TYPES: 'false',
                    },
                    dev: true,
                  })
                },
              },
            ],
            { rendererOptions: { collapseSubtasks: false } },
          )
        },
      },
      {
        title: 'Adding the Tailwind CSS plugin to the Vite config...',
        task: (_ctx: unknown, task: { skip: (msg?: string) => void }) => {
          // `resolveFile` returns null when there is no vite config, even
          // though the `Paths` type says `string`
          const viteConfigPath: string | null = rwPaths.web.viteConfig

          if (!viteConfigPath || !fs.existsSync(viteConfigPath)) {
            throw new Error('Could not find web/vite.config.{ts,js}')
          }

          const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

          if (viteConfig.includes('@tailwindcss/vite')) {
            task.skip('The Tailwind CSS Vite plugin is already configured')
            return
          }

          const viteConfigWithPlugin = insertPluginsBeforeCedar({
            content: viteConfig,
            pluginCodes: ['tailwindcss()'],
          })

          if (!viteConfigWithPlugin) {
            throw new Error(
              `Could not find \`cedar()\` in the plugins array in ${viteConfigPath}.\n` +
                "Add `import tailwindcss from '@tailwindcss/vite'` to the top " +
                'of the file and `tailwindcss()` to the plugins array ' +
                'yourself, and then run this command again.',
            )
          }

          const tailwindPluginImport =
            "import tailwindcss from '@tailwindcss/vite'\n"
          // Keep imports sorted by placing the plugin import right above the
          // import from 'vite', or above the first import if there is none.
          // Triple-slash directives at the top of the file must stay first
          const importAnchor =
            /^import .* from ['"]vite['"]/m.exec(viteConfigWithPlugin) ??
            /^import /m.exec(viteConfigWithPlugin)
          const insertAt = importAnchor?.index ?? 0

          fs.writeFileSync(
            viteConfigPath,
            viteConfigWithPlugin.slice(0, insertAt) +
              tailwindPluginImport +
              viteConfigWithPlugin.slice(insertAt),
          )
        },
      },
      {
        title: 'Adding Tailwind CSS import to index.css...',
        task: (_ctx: unknown, task: { skip: (msg?: string) => void }) => {
          const INDEX_CSS_PATH = path.join(rwPaths.web.src, 'index.css')
          const indexCSS = fs.readFileSync(INDEX_CSS_PATH, 'utf-8')

          if (tailwindImportRegExp.test(indexCSS)) {
            task.skip('Tailwind CSS import already exists in index.css')
          } else {
            const newIndexCSS = tailwindImportAndNotes.join('\n') + indexCSS
            fs.writeFileSync(INDEX_CSS_PATH, newIndexCSS)
          }
        },
      },
      {
        title: "Updating 'scaffold.css' to use tailwind classes...",
        skip: () => {
          // Skip this step if the 'scaffold.css' file doesn't exist
          return (
            !fs.existsSync(path.join(rwPaths.web.src, 'scaffold.css')) &&
            "No 'scaffold.css' file to update"
          )
        },
        task: async (
          _ctx: unknown,
          task: {
            skip: (msg?: string) => void
            prompt: (adapter: unknown) => {
              run: (config: unknown) => Promise<boolean>
            }
          },
        ) => {
          const prompt = task.prompt(ListrEnquirerPromptAdapter)
          const overrideScaffoldCss =
            force ||
            (await prompt.run({
              type: 'Confirm',
              message:
                "Do you want to override your 'scaffold.css' to use tailwind classes?",
            }))

          if (!overrideScaffoldCss) {
            return task.skip("Skipping 'scaffold.css' update")
          }

          const tailwindScaffoldTemplate = fs.readFileSync(
            path.join(
              import.meta.dirname,
              '..',
              '..',
              '..',
              'generate',
              'scaffold',
              'templates',
              'assets',
              'scaffold.tailwind.css.template',
            ),
          )
          fs.writeFileSync(
            path.join(rwPaths.web.src, 'scaffold.css'),
            tailwindScaffoldTemplate,
          )
        },
      },
      {
        title: 'Adding recommended VS Code extensions to project settings...',
        skip: () => !usingVSCode() && "Looks like you're not using VS Code",
        task: () => {
          const VS_CODE_EXTENSIONS_PATH = path.join(
            rwPaths.base,
            '.vscode/extensions.json',
          )

          let originalExtensionsJson: { recommendations?: string[] } = {}

          if (fs.existsSync(VS_CODE_EXTENSIONS_PATH)) {
            const originalExtensionsFile = fs.readFileSync(
              VS_CODE_EXTENSIONS_PATH,
              'utf-8',
            )

            // JSON.parse returns `any`; we assert the expected extensions.json shape here.
            // `recommendations` is optional so we default to [] when spreading below.
            originalExtensionsJson = JSON.parse(originalExtensionsFile) as {
              recommendations?: string[]
            }
          }

          const newExtensionsJson = {
            ...originalExtensionsJson,
            recommendations: [
              ...(originalExtensionsJson.recommendations ?? []),
              ...recommendedVSCodeExtensions,
            ],
          }

          fs.writeFileSync(
            VS_CODE_EXTENSIONS_PATH,
            JSON.stringify(newExtensionsJson, null, 2),
          )
        },
      },
      {
        title:
          'Adding tailwind intellisense plugin configuration to VS Code settings...',
        skip: () => !usingVSCode() && "Looks like you're not using VS Code",
        task: () => {
          // Adds support for Redwood specific className props to tailwind intellisense
          //   "tailwindCSS.classAttributes": [
          //     "class",
          //     "className",
          //     "activeClassName",
          //     "errorClassName"
          //   ]
          // The default value for this setting is:
          //   ["class", "className", "ngClass", "class:list"]
          //
          // Also associates .css files with Tailwind's CSS language mode, so
          // VS Code understands directives like `@theme` and `@reference`

          const VS_CODE_SETTINGS_PATH = path.join(
            rwPaths.base,
            '.vscode/settings.json',
          )

          const classAttributes = [
            'class',
            'className',
            'activeClassName',
            'errorClassName',
          ]

          const fileAssociations = { '*.css': 'tailwindcss' }

          let newSettingsJson: Record<string, unknown> = {
            ['files.associations']: fileAssociations,
            ['tailwindCSS.classAttributes']: classAttributes,
          }

          if (fs.existsSync(VS_CODE_SETTINGS_PATH)) {
            const originalSettingsFile = fs.readFileSync(
              VS_CODE_SETTINGS_PATH,
              'utf-8',
            )
            // JSON.parse returns `any`; Record<string, unknown> is the safest
            // general shape for a VS Code settings JSON object.
            const originalSettingsJson = JSON.parse(
              originalSettingsFile || '{}',
            ) as Record<string, unknown>
            const existingAttributes =
              originalSettingsJson['tailwindCSS.classAttributes']
            const originalTwClassAttributesJson = Array.isArray(
              existingAttributes,
            )
              ? existingAttributes
              : []

            const mergedClassAttributes = Array.from(
              new Set([...classAttributes, ...originalTwClassAttributesJson]),
            )

            const existingAssociations =
              originalSettingsJson['files.associations']

            newSettingsJson = {
              ...originalSettingsJson,
              ['files.associations']: {
                ...(typeof existingAssociations === 'object'
                  ? existingAssociations
                  : {}),
                ...fileAssociations,
              },
              ['tailwindCSS.classAttributes']: mergedClassAttributes,
            }
          }

          fs.writeFileSync(
            VS_CODE_SETTINGS_PATH,
            JSON.stringify(newSettingsJson, null, 2) + '\n',
          )
        },
      },
      {
        title: 'Adding tailwind stylesheet entry in prettier...',
        task: async (_ctx: unknown) => {
          const prettierConfigPath = path.join(
            rwPaths.base,
            'prettier.config.cjs',
          )
          // Point the tailwindcss ordering plugin to the CSS entry point
          const prettierConfig = fs.readFileSync(prettierConfigPath, 'utf-8')
          const tailwindStylesheetPath = path
            .relative(rwPaths.base, path.join(rwPaths.web.src, 'index.css'))
            .replaceAll('\\', '/')
          const tailwindStylesheetEntry = `tailwindStylesheet: './${tailwindStylesheetPath}',`

          let newPrettierConfig = prettierConfig
          const existingEntryRegExp = /tailwindStylesheet: .*(,)?/

          if (existingEntryRegExp.test(newPrettierConfig)) {
            if (force) {
              newPrettierConfig = newPrettierConfig.replace(
                existingEntryRegExp,
                tailwindStylesheetEntry,
              )
            } else {
              throw new Error(
                'tailwindStylesheet setting already exists in prettier configuration.\nUse --force to override existing config.',
              )
            }
          } else {
            newPrettierConfig = newPrettierConfig.replace(
              /,(\n\s*)(\}\n?)$/,
              `,\n  ${tailwindStylesheetEntry}$1$2`,
            )
          }

          fs.writeFileSync(prettierConfigPath, newPrettierConfig)
        },
      },
      {
        title: 'Adding tailwind prettier plugin...',
        task: async (_ctx: unknown, task: { skip: (msg?: string) => void }) => {
          const prettierConfigPath = path.join(
            rwPaths.base,
            'prettier.config.cjs',
          )
          // Add tailwindcss ordering plugin to prettier
          const prettierConfig = fs.readFileSync(prettierConfigPath, 'utf-8')

          let newPrettierConfig = prettierConfig
          if (newPrettierConfig.includes('plugins: [')) {
            const pluginsMatch = newPrettierConfig.match(
              /plugins: \[[\sa-z\(\)'\-,]*]/,
            )

            const matched: string | undefined =
              pluginsMatch != null ? pluginsMatch[0] : undefined

            if (
              matched &&
              (matched.includes("'prettier-plugin-tailwindcss'") ||
                matched.includes('"prettier-plugin-tailwindcss"'))
            ) {
              task.skip(
                'tailwindcss-plugin-prettier already required in plugins',
              )
            } else {
              newPrettierConfig = newPrettierConfig.replace(
                /plugins: \[(\n\s+)*/,
                `plugins: [$'prettier-plugin-tailwindcss',$1`,
              )
            }
          } else {
            newPrettierConfig = newPrettierConfig.replace(
              /,(\n\s*)(\}\n?)$/,
              `,\n  plugins: ['prettier-plugin-tailwindcss'],$1$2`,
            )
          }

          fs.writeFileSync(prettierConfigPath, newPrettierConfig)
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
    await recommendExtensionsToInstall()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    errorTelemetry(process.argv, msg)
    console.error(c.error(msg))
    process.exit(exitCode)
  }
}
