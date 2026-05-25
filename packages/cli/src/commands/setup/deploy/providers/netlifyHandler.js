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

      // Add import statements before the vite import
      if (!hasNetlifyPlugin || !hasNetlifyCompat) {
        content = content.replace(
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
      }

      // Add plugin calls before cedar() in the plugins array
      if (!content.includes('netlifyCompat(')) {
        content = content.replace(
          /(plugins:\s*\[)([\s\S]*?)(cedar\s*\()/,
          (match, prefix, beforeCedar, cedarCall) => {
            const hasNewline = beforeCedar.includes('\n')
            if (hasNewline) {
              const indent = beforeCedar.match(/\n(\s*)$/)?.[1] || '  '
              return `${prefix}${beforeCedar}  netlify({ build: { enabled: true } }),\n${indent}netlifyCompat(),\n${indent}${cedarCall}`
            }
            return `${prefix}netlify({ build: { enabled: true } }), netlifyCompat(), ${beforeCedar}${cedarCall}`
          },
        )
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
      ud && installNetlifyPackagesTask(),
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
