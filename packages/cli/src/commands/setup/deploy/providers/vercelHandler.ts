import fs from 'node:fs'
import path from 'path'

import { Listr, type ListrTask } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  addPackagesTask,
  getPaths,
  printSetupNotes,
  writeFile,
} from '../../../../lib/index.js'
import {
  insertPluginsBeforeCedar,
  updateApiURLTask,
  verifyUDSetupTask,
  // @ts-expect-error - No types for JS files
} from '../helpers/index.js'

export async function handler({ force, ud }: { force: boolean; ud: boolean }) {
  recordTelemetryAttributes({
    command: 'setup deploy vercel',
    force,
    ud,
  })

  const tasks = new Listr(
    [
      ud && verifyUDSetupTask(),
      ud && (await installVercelPackagesTask()),
      ud && addVercelPluginToViteConfigTask(),
      !ud && updateApiURLTask('/api'),
      ud
        ? writeVercelUDConfigTask({ overwriteExisting: force })
        : writeVercelConfigTask({ overwriteExisting: force }),
      printSetupNotes(ud ? udNotes : notes),
    ].filter((task): task is ListrTask => Boolean(task)),
    {
      rendererOptions: { collapseSubtasks: false },
    },
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

function addVercelPluginToViteConfigTask(): ListrTask {
  return {
    title: 'Adding Vercel plugin to vite config...',
    task: async (_ctx: unknown, task: { skip: (msg: string) => void }) => {
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

      const hasVercelPlugin = content.includes('vite-plugin-vercel')

      if (hasVercelPlugin && content.includes('vercel(')) {
        task.skip('Vercel plugin is already configured.')
        return
      }

      // Add import statement
      if (!hasVercelPlugin) {
        const newContent = content.replace(
          /(import\s+\{[^}]*\}\s+from\s+['"]vite['"];?)/,
          "import { vercel } from 'vite-plugin-vercel/vite'\n$1",
        )

        if (newContent === content) {
          // No 'vite' named import found — prepend at the top of the file
          content =
            "import { vercel } from 'vite-plugin-vercel/vite'\n" + content
        } else {
          content = newContent
        }
      }

      // Add plugin call before cedar() in the plugins array.
      // outDir is set to '../.vercel/output' because vite-plugin-vercel
      // resolves outDir relative to the Vite root (web/), but the output
      // must land at the project root. This also avoids a bug where the
      // plugin captures process.cwd() at module load time instead of build
      // time.
      if (!content.includes('vercel(')) {
        const result = insertPluginsBeforeCedar({
          content,
          pluginCodes: ["vercel({ outDir: '../.vercel/output' })"],
        })

        if (result) {
          content = result
        }
      }

      fs.writeFileSync(viteConfigPath, content)
    },
  }
}

function installVercelPackagesTask(): Promise<ListrTask> {
  return addPackagesTask({
    packages: ['vite-plugin-vercel'],
    devDependency: true,
  })
}

function writeVercelConfigTask({
  overwriteExisting = false,
}: { overwriteExisting?: boolean } = {}): ListrTask {
  return {
    title: 'Writing vercel.json...',
    task: (_ctx: unknown, task: { title?: string }) => {
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
    command: 'yarn cedar build --ud --verbose --apiRootPath=/.api/functions',
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

function writeVercelUDConfigTask({
  overwriteExisting = false,
}: { overwriteExisting?: boolean } = {}): ListrTask {
  return {
    title: 'Writing vercel.json for Universal Deploy...',
    task: (_ctx: unknown, task: { title?: string }) => {
      writeFile(
        path.join(getPaths().base, 'vercel.json'),
        JSON.stringify(vercelUDConfig, null, 2),
        { overwriteExisting },
        task,
      )
    },
  }
}
