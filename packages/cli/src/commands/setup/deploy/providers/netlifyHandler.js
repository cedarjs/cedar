import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  addPackagesTask,
  getPaths,
  printSetupNotes,
} from '../../../../lib/index.js'
import {
  addFilesTask,
  insertPluginsBeforeCedar,
  updateApiURLTask,
  verifyUDSetupTask,
} from '../helpers/index.js'
import { NETLIFY_TOML } from '../templates/netlify.js'
import { NETLIFY_UD_TOML } from '../templates/netlifyUD.js'

const files = [
  {
    path: path.join(getPaths().base, 'netlify.toml'),
    content: NETLIFY_TOML,
  },
]

const filesUd = [
  {
    path: path.join(getPaths().base, 'netlify.toml'),
    content: NETLIFY_UD_TOML,
  },
]

const notes = [
  'You are ready to deploy to Netlify!',
  'See: https://cedarjs.com/docs/deploy/netlify',
]

const udNotes = [
  'You are ready to deploy to Netlify with Universal Deploy!',
  'Build with: yarn cedar build --ud',
  'See: https://cedarjs.com/docs/deploy/netlify',
]

function addNetlifyPluginsToViteConfigTask() {
  return {
    title: 'Adding Netlify plugins to vite config...',
    task: async (_ctx, task) => {
      const paths = getPaths()
      const viteConfigTs = path.join(paths.web.base, 'vite.config.ts')
      const viteConfigJs = path.join(paths.web.base, 'vite.config.js')
      const viteConfigPath = fs.existsSync(viteConfigTs)
        ? viteConfigTs
        : viteConfigJs

      if (!fs.existsSync(viteConfigPath)) {
        task.skip(`${viteConfigPath} not found`)
        return
      }

      let content = fs.readFileSync(viteConfigPath, 'utf-8')

      const hasNetlifyPlugin = content.includes('@netlify/vite-plugin')
      const hasNetlifyCompat = content.includes(
        '@universal-deploy/netlify/vite',
      )

      if (
        hasNetlifyPlugin &&
        hasNetlifyCompat &&
        content.includes('netlifyCompat(')
      ) {
        task.skip('Netlify plugins are already configured.')
        return
      }

      // Add import statements
      if (!hasNetlifyPlugin || !hasNetlifyCompat) {
        const newContent = content.replace(
          /(import\s+\{[^}]*\}\s+from\s+['"]vite['"];?)/,
          (match) => {
            let result = match

            if (!hasNetlifyPlugin) {
              result = `import netlify from '@netlify/vite-plugin'\n${result}`
            }

            if (!hasNetlifyCompat) {
              result = `import netlifyCompat from '@universal-deploy/netlify/vite'\n${result}`
            }

            return result
          },
        )

        if (newContent === content) {
          // No 'vite' named import found — prepend at the top of the file
          let prepend = ''

          if (!hasNetlifyPlugin) {
            prepend += "import netlify from '@netlify/vite-plugin'\n"
          }

          if (!hasNetlifyCompat) {
            prepend +=
              "import netlifyCompat from '@universal-deploy/netlify/vite'\n"
          }

          content = prepend + content
        } else {
          content = newContent
        }
      }

      // Add plugin calls before cedar() in the plugins array
      if (!content.includes('netlifyCompat(')) {
        const result = insertPluginsBeforeCedar({
          content,
          pluginCodes: [
            'netlify({ build: { enabled: true } })',
            'netlifyCompat()',
          ],
        })

        if (result) {
          content = result
        }
      }

      fs.writeFileSync(viteConfigPath, content)
    },
  }
}

function installNetlifyPackagesTask() {
  return addPackagesTask({
    packages: ['@netlify/vite-plugin', '@universal-deploy/netlify'],
    devDependency: true,
  })
}

export const handler = async ({ force, ud }) => {
  recordTelemetryAttributes({
    command: 'setup deploy netlify',
    force,
    ud,
  })
  const tasks = new Listr(
    [
      ud && verifyUDSetupTask(),
      ud && (await installNetlifyPackagesTask()),
      ud && addNetlifyPluginsToViteConfigTask(),
      !ud && updateApiURLTask('/.netlify/functions'),
      addFilesTask({ files: ud ? filesUd : files, force }),
      printSetupNotes(ud ? udNotes : notes),
    ].filter(Boolean),
    { rendererOptions: { collapseSubtasks: false } },
  )
  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
