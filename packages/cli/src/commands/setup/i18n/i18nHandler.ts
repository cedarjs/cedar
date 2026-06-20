import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers'
import { addWorkspacePackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - No types for JS files
import extendStorybookConfiguration from '../../../lib/configureStorybook.js'
// @ts-expect-error - No types for JS files
import { fileIncludes } from '../../../lib/extendFile.js'
import { getPaths, writeFile } from '../../../lib/index.js'

const APP_JS_PATH = getPaths().web.app

const i18nImportExist = (appJS: Buffer) => {
  const content = appJS.toString()

  const hasBaseImport = () => /import '.\/i18n'/.test(content)

  return hasBaseImport()
}

const addI18nImport = (appJS: Buffer) => {
  const content = appJS.toString().split('\n').reverse()
  const index = content.findIndex((value) => value.includes('import'))
  content.splice(index, 0, "import './i18n'")
  return content.reverse().join(`\n`)
}

const i18nConfigExists = () => {
  return fs.existsSync(path.join(getPaths().web.src, 'i18n.js'))
}

const localesExists = (lng: string) => {
  return fs.existsSync(path.join(getPaths().web.src, 'locales', lng + '.json'))
}

export const handler = async ({ force }: { force: boolean }) => {
  const rwPaths = getPaths()
  const tasks = new Listr(
    [
      {
        title: 'Installing packages...',
        task: async () => {
          return new Listr(
            [
              {
                title:
                  'Install i18next, react-i18next and i18next-browser-languagedetector',
                task: async () => {
                  /**
                   * Install i18next, react-i18next and i18next-browser-languagedetector
                   */
                  await addWorkspacePackages(
                    'web',
                    [
                      'i18next',
                      'react-i18next',
                      'i18next-browser-languagedetector',
                    ],
                    { cwd: rwPaths.base },
                  )
                },
              },
            ],
            { rendererOptions: { collapseSubtasks: false } },
          )
        },
      },
      {
        title: 'Configure i18n...',
        task: () => {
          /**
           *  Write i18n.js in web/src
           *
           * Check if i18n config already exists.
           * If it exists, throw an error.
           */
          if (!force && i18nConfigExists()) {
            throw new Error(
              'i18n config already exists.\nUse --force to override existing config.',
            )
          } else {
            return writeFile(
              path.join(getPaths().web.src, 'i18n.js'),
              fs
                .readFileSync(
                  path.resolve(
                    import.meta.dirname,
                    'templates',
                    'i18n.js.template',
                  ),
                )
                .toString(),
              { overwriteExisting: force },
            )
          }
        },
      },
      {
        title: 'Adding locale file for French...',
        task: () => {
          /**
           * Make web/src/locales if it doesn't exist
           * and write fr.json there
           *
           * Check if fr.json already exists.
           * If it exists, throw an error.
           */

          if (!force && localesExists('fr')) {
            throw new Error(
              'fr.json config already exists.\nUse --force to override existing config.',
            )
          } else {
            return writeFile(
              path.join(getPaths().web.src, '/locales/fr.json'),
              fs
                .readFileSync(
                  path.resolve(
                    import.meta.dirname,
                    'templates',
                    'fr.json.template',
                  ),
                )
                .toString(),
              { overwriteExisting: force },
            )
          }
        },
      },
      {
        title: 'Adding locale file for English...',
        task: () => {
          /**
           * Make web/src/locales if it doesn't exist
           * and write en.json there
           *
           * Check if en.json already exists.
           * If it exists, throw an error.
           */
          if (!force && localesExists('en')) {
            throw new Error(
              'en.json already exists.\nUse --force to override existing config.',
            )
          } else {
            return writeFile(
              path.join(getPaths().web.src, '/locales/en.json'),
              fs
                .readFileSync(
                  path.resolve(
                    import.meta.dirname,
                    'templates',
                    'en.json.template',
                  ),
                )
                .toString(),
              { overwriteExisting: force },
            )
          }
        },
      },
      {
        title: 'Adding import to App.{jsx,tsx}...',
        task: (_ctx: unknown, task: { skip: (message: string) => void }) => {
          /**
           * Add i18n import to the last import of App.{jsx,tsx}
           *
           * Check if i18n import already exists.
           * If it exists, throw an error.
           */
          const appJS = fs.readFileSync(APP_JS_PATH)
          if (i18nImportExist(appJS)) {
            task.skip('Import already exists in App.js')
          } else {
            fs.writeFileSync(APP_JS_PATH, addI18nImport(appJS))
          }
        },
      },
      {
        title: 'Configuring Storybook...',
        // skip this task if the user's storybook config already includes "withI18n"
        skip: () => fileIncludes(rwPaths.web.storybookConfig, 'withI18n'),
        task: async () =>
          extendStorybookConfiguration(
            path.join(
              import.meta.dirname,
              'templates',
              'storybook.preview.tsx.template',
            ),
          ),
      },
      {
        title: 'One more thing...',
        task: (_ctx: unknown, task: { title: string }) => {
          task.title = `One more thing...\n
          ${c.tip('Quick link to the docs:')}\n
          ${terminalLink('react-i18next quick start guide', 'https://react.i18next.com/guides/quick-start/')}
        `
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await tasks.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    // exitCode is a non-standard property Listr2 errors may carry
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}
