import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { addPackagesTask, getPaths, printSetupNotes, writeFile } from '../../../../lib/index.js'
import { updateApiURLTask, verifyUDSetupTask } from '../helpers/index.js'

export async function handler({ force, ud }) {
  recordTelemetryAttributes({
    command: 'setup deploy vercel',
    force,
    ud,
  })

  const tasks = new Listr(
    [
      ud && verifyUDSetupTask(),
      ud && installVercelPackagesTask(),
      ud && addVercelPluginToViteConfigTask(),
      !ud && updateApiURLTask('/api'),
      ud
        ? writeVercelUDConfigTask({ overwriteExisting: force })
        : writeVercelConfigTask({ overwriteExisting: force }),
      printSetupNotes(ud ? udNotes : notes),
    ].filter(Boolean),
    {
      rendererOptions: { collapseSubtasks: false },
    },
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}

function addVercelPluginToViteConfigTask() {
  return {
    title: 'Adding Vercel plugin to vite config...',
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

      if (content.includes('vite-plugin-vercel')) {
        task.skip('Vercel plugin is already configured.')
        return
      }

      // Add import statement before the vite import
      content = content.replace(
        /(import\s+\{[^}]*\}\s+from\s+['"]vite['"];?)/,
        "import { vercel } from 'vite-plugin-vercel/vite'\n$1",
      )

      // Add plugin call before cedar() in the plugins array
      content = content.replace(
        /(plugins:\s*\[)([\s\S]*?)(cedar\s*\()/,
        (match, prefix, beforeCedar, cedarCall) => {
          const hasNewline = beforeCedar.includes('\n')
          if (hasNewline) {
            const indent = beforeCedar.match(/\n(\s*)$/)?.[1] || '  '
            return `${prefix}${beforeCedar}  vercel(),\n${indent}${cedarCall}`
          }
          return `${prefix}vercel(), ${beforeCedar}${cedarCall}`
        },
      )

      fs.writeFileSync(viteConfigPath, content)
    },
  }
}

function installVercelPackagesTask() {
  return addPackagesTask({
    packages: ['vite-plugin-vercel'],
    devDependency: true,
  })
}

function writeVercelConfigTask({ overwriteExisting = false } = {}) {
  return {
    title: 'Writing vercel.json...',
    task: (_ctx, task) => {
      writeFile(
        path.join(getPaths().base, 'vercel.json'),
        JSON.stringify(vercelConfig, null, 2),
        { overwriteExisting },
        task,
      )
    },
  }
}

const vercelConfig = {
  build: {
    env: {
      ENABLE_EXPERIMENTAL_COREPACK: '1',
    },
  },
}

const vercelUDConfig = {
  build: {
    command: 'yarn cedar build --ud --verbose',
    env: {
      ENABLE_EXPERIMENTAL_COREPACK: '1',
    },
  },
}

const notes = [
  'You are ready to deploy to Vercel!',
  'See: https://cedarjs.com/docs/deploy#vercel-deploy',
]

const udNotes = [
  'You are ready to deploy to Vercel with Universal Deploy!',
  'Build with: yarn cedar build --ud',
  'See: https://cedarjs.com/docs/deploy#vercel-deploy',
]

function writeVercelUDConfigTask({ overwriteExisting = false } = {}) {
  return {
    title: 'Writing vercel.json for Universal Deploy...',
    task: (_ctx, task) => {
      writeFile(
        path.join(getPaths().base, 'vercel.json'),
        JSON.stringify(vercelUDConfig, null, 2),
        { overwriteExisting },
        task,
      )
    },
  }
}
