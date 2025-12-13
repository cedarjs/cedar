import fs from 'node:fs'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import execa from 'execa'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../../lib/colors.js'
import { getPaths, usingVSCode } from '../../../../lib/index.js'

const tailwindDirectives = [
  '@import "tailwindcss";',
  '@custom-variant dark (&:where(.dark, .dark *));',
]

/** @param {string} indexCSS */
const tailwindDirectivesExist = (indexCSS) =>
  tailwindDirectives.every((tailwindDirective) =>
    indexCSS.includes(tailwindDirective),
  )

const tailwindImportsAndNotes = [
  '/**',
  ' * START --- SETUP TAILWINDCSS V4 EDIT',
  ' *',
  ' * `yarn cedar setup ui tailwind4` placed these directives here',
  " * to import Tailwind's compiled styles into your CSS.",
  ' * For more information, see: https://tailwindcss.com/docs/installation',
  ' */',
  ...tailwindDirectives,
  '/**',
  ' * END --- SETUP TAILWINDCSS V4 EDIT',
  ' */\n',
]

const recommendedVSCodeExtensions = [
  'csstools.postcss',
  'bradlc.vscode-tailwindcss',
]

const recommendationTexts = {
  'csstools.postcss': terminalLink(
    'PostCSS Language Support',
    'https://marketplace.visualstudio.com/items?itemName=csstools.postcss',
  ),
  'bradlc.vscode-tailwindcss': terminalLink(
    'Tailwind CSS IntelliSense',
    'https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss',
  ),
}

async function recommendExtensionsToInstall() {
  if (!usingVSCode()) {
    return
  }

  let recommendations = []

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

export const handler = async ({ force, install }) => {
  recordTelemetryAttributes({
    command: 'setup ui tailwind4',
    force,
    install,
  })
  const rwPaths = getPaths()

  const webWorkspacePackages = [
    'tailwindcss@^4.1.17',
    '@tailwindcss/vite@^4.1.17',
  ]

  const tasks = new Listr(
    [
      {
        title: 'Installing web side packages...',
        skip: () => !install,
        task: () => {
          return new Listr(
            [
              {
                title: `Install ${webWorkspacePackages.join(', ')}`,
                task: async () => {
                  await execa(
                    'yarn',
                    ['workspace', 'web', 'add', '-D', ...webWorkspacePackages],
                    {
                      cwd: rwPaths.base,
                      env: {
                        // For some reason yarn started installing deprecated
                        // typescript types when installing tailwind. This
                        // prevents it from happening.
                        YARN_TS_ENABLE_AUTO_TYPES: 'false',
                      },
                    },
                  )
                },
              },
            ],
            { rendererOptions: { collapseSubtasks: false } },
          )
        },
      },
      {
        title: 'Adding tailwind import and plugin to Vite config...',
        task: () => {
          const viteConfigFilenames = [
            'vite.config.mts',
            'vite.config.ts',
            'vite.config.js',
            'vite.config.cjs',
          ].map((f) => path.join(rwPaths.web.base, f))

          // If a TS config exists but an MTS does not, rename it to .mts because
          // Tailwind + modern tooling expect an ESM config file. Inform the user.
          const tsPath = path.join(rwPaths.web.base, 'vite.config.ts')
          const mtsPath = path.join(rwPaths.web.base, 'vite.config.mts')
          try {
            if (fs.existsSync(tsPath) && !fs.existsSync(mtsPath)) {
              fs.renameSync(tsPath, mtsPath)
              console.log()
              console.log(
                c.info(
                  `Renamed 'vite.config.ts' to 'vite.config.mts' to enable ESM (required by Tailwind v4). You can undo this change if you need a CommonJS config.`,
                ),
              )
            } else if (fs.existsSync(tsPath) && fs.existsSync(mtsPath)) {
              console.log()
              console.log(
                c.info(
                  "Both 'vite.config.ts' and 'vite.config.mts' exist. Keeping existing files — please remove or merge duplicates manually.",
                ),
              )
            }
          } catch (err) {
            // If rename fails, surface a helpful message but continue to try to modify existing files.
            console.log()
            console.log(
              c.info(
                "Failed to rename 'vite.config.ts' to 'vite.config.mts'. Please rename manually to enable ESM.",
              ),
            )
          }

          const viteConfigPath = viteConfigFilenames.find((p) =>
            fs.existsSync(p),
          )
          if (!viteConfigPath) {
            throw new Error(
              'No Vite config found (checked vite.config.mts, vite.config.ts, vite.config.js, vite.config.cjs).',
            )
          }

          let viteConfig = fs.readFileSync(viteConfigPath, 'utf-8')

          const importStatement = `import tailwindcss from '@tailwindcss/vite';`
          if (!viteConfig.includes(importStatement)) {
            // Find the top-of-file import block robustly.
            // Support multiple import lines, multiline imports, and blank lines between grouped imports.
            const lines = viteConfig.split(/\r?\n/)
            let importBlockEnd = 0
            let inImport = false

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              const trimmed = line.trim()

              if (trimmed === '') {
                // blank line: allow before first import or between import groups
                continue
              }

              if (trimmed.startsWith('import ')) {
                inImport = true
                importBlockEnd = i + 1
                continue
              }

              // continuation lines for multiline imports often start with whitespace
              // or may start with 'from' when broken across lines. Treat those as part
              // of the import block if we've already seen an import.
              if (
                inImport &&
                (line.startsWith(' ') ||
                  line.startsWith('\t') ||
                  trimmed.startsWith('from '))
              ) {
                importBlockEnd = i + 1
                continue
              }

              // encountered a non-import, non-blank, non-continuation line -> stop scanning
              if (!inImport) {
                importBlockEnd = 0
              }
              break
            }

            if (importBlockEnd > 0) {
              // insert the import after the detected import block
              lines.splice(importBlockEnd, 0, importStatement)
              viteConfig = lines.join('\n')
            } else {
              // no imports found at top of file, prepend the import
              viteConfig = importStatement + '\n\n' + viteConfig
            }
          }

          // Add tailwindcss() to plugins array if missing
          if (!viteConfig.includes('tailwindcss()')) {
            // This regex finds the first plugins: [ ... ] block (non-greedy)
            const pluginsRegex = /(plugins\s*:\s*\[)([\s\S]*?)(\])/m
            if (pluginsRegex.test(viteConfig)) {
              viteConfig = viteConfig.replace(
                pluginsRegex,
                (_match, start, inner, end) => {
                  const trimmedInner = inner.replace(/\s+$/m, '')

                  if (!trimmedInner) {
                    return `${start} ${'tailwindcss()'} ${end}`
                  }
                  // Ensure comma separation
                  const separator = /,\s*$/.test(trimmedInner) ? '' : ', '
                  return `${start}${trimmedInner}${separator}${'tailwindcss()'}${end}`
                },
              )
            } else {
              // If there's no plugins: [] pattern (rare), try to add a plugins array into defineConfig
              const defineConfigRegex =
                /export\s+default\s+defineConfig\s*\(\s*\{\s*/m
              if (defineConfigRegex.test(viteConfig)) {
                viteConfig = viteConfig.replace(
                  defineConfigRegex,
                  (m) => m + `plugins: [tailwindcss()],\n`,
                )
              } else {
                // Fallback: just append a plugins entry at the end
                viteConfig =
                  viteConfig +
                  `\n\n// Added by cedar setup: add Tailwind plugin\nexport default { plugins: [tailwindcss()] };\n`
              }
            }
          }

          // Write back the config
          fs.writeFileSync(viteConfigPath, viteConfig, 'utf-8')
        },
      },
      {
        title: 'Adding directives to index.css...',
        task: (_ctx, task) => {
          const INDEX_CSS_PATH = path.join(rwPaths.web.src, 'index.css')
          const indexCSS = fs.readFileSync(INDEX_CSS_PATH, 'utf-8')

          if (tailwindDirectivesExist(indexCSS)) {
            task.skip('Directives already exist in index.css')
          } else {
            const newIndexCSS = tailwindImportsAndNotes.join('\n') + indexCSS
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
        task: async (_ctx, task) => {
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

          let originalExtensionsJson = { recommendations: [] }

          if (fs.existsSync(VS_CODE_EXTENSIONS_PATH)) {
            const originalExtensionsFile = fs.readFileSync(
              VS_CODE_EXTENSIONS_PATH,
              'utf-8',
            )

            originalExtensionsJson = JSON.parse(originalExtensionsFile)
          }

          const newExtensionsJson = {
            ...originalExtensionsJson,
            recommendations: [
              ...originalExtensionsJson.recommendations,
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

          let newSettingsJson = {
            ['tailwindCSS.classAttributes']: classAttributes,
          }

          if (fs.existsSync(VS_CODE_SETTINGS_PATH)) {
            const originalSettingsFile = fs.readFileSync(
              VS_CODE_SETTINGS_PATH,
              'utf-8',
            )
            const originalSettingsJson = JSON.parse(
              originalSettingsFile || '{}',
            )
            const originalTwClassAttributesJson =
              originalSettingsJson['tailwindCSS.classAttributes'] || []

            const mergedClassAttributes = Array.from(
              new Set([...classAttributes, ...originalTwClassAttributesJson]),
            )

            newSettingsJson = {
              ...originalSettingsJson,
              ['tailwindCSS.classAttributes']: mergedClassAttributes,
            }
          }

          fs.writeFileSync(
            VS_CODE_SETTINGS_PATH,
            JSON.stringify(newSettingsJson, null, 2) + '\n',
          )
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
    await recommendExtensionsToInstall()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
