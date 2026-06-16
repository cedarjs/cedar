import fs from 'node:fs'
import path from 'path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import { Listr } from 'listr2'
import type { ListrPromptAdapter } from 'listr2'

import { addWebPackages, colors as c } from '@cedarjs/cli-helpers'
import { getConfigPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../lib/index.js'
import { isTypeScriptProject } from '../../lib/project.js'

import {
  command,
  description,
  EXPERIMENTAL_TOPIC_ID,
} from './setupStreamingSsr.js'
import { printTaskEpilogue } from './util.js'

interface Opts {
  force: boolean
  verbose: boolean
}

interface TaskHandle {
  output: string
  skip(message?: string): void
  // The any[] rest parameter in prompt's constructor arg is very difficult to
  // get rid of because the actual TaskWrapper.prompt constructor takes Task and
  // TaskWrapper types with generic renderer params that can't be known at the
  // factory function level (they differ between verbose/default branches).
  prompt<T extends ListrPromptAdapter>(adapter: new (...args: any[]) => T): T
}

export const handler = async (options: Opts) => {
  const cedarPaths = getPaths()
  const configPath = getConfigPath()
  const configContent = fs.readFileSync(configPath, 'utf-8')
  const ts = isTypeScriptProject()
  const ext = path.extname(cedarPaths.web.entryClient || '')

  function buildTaskData() {
    return [
      {
        title: 'Check prerequisites',
        task: () => {
          if (!cedarPaths.web.entryClient || !cedarPaths.web.viteConfig) {
            throw new Error(
              'Vite needs to be setup before you can enable Streaming SSR',
            )
          }
        },
      },
      {
        title: 'Adding config to cedar.toml...',
        task: (_ctx: unknown, task: TaskHandle) => {
          if (!configContent.includes('[experimental.streamingSsr]')) {
            writeFile(
              configPath,
              configContent.concat(
                `\n[experimental.streamingSsr]\n  enabled = true\n`,
              ),
              {
                overwriteExisting: true, // cedar.toml always exists
              },
            )
          } else {
            if (options.force) {
              task.output = 'Overwriting config in cedar.toml'

              writeFile(
                configPath,
                configContent.replace(
                  // Enable if it's currently disabled
                  `\n[experimental.streamingSsr]\n  enabled = false\n`,
                  `\n[experimental.streamingSsr]\n  enabled = true\n`,
                ),
                {
                  overwriteExisting: true, // cedar.toml always exists
                },
              )
            } else {
              task.skip(
                'The [experimental.streamingSsr] config block already exists ' +
                  'in your cedar.toml file.',
              )
            }
          }
        },
      },
      {
        title: `Adding entry.client${ext}...`,
        task: async (_ctx: unknown, task: TaskHandle) => {
          const entryClientTemplate = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'streamingSsr',
              'entry.client.tsx.template',
            ),
            'utf-8',
          )
          let entryClientPath = cedarPaths.web.entryClient

          if (!entryClientPath) {
            throw new Error('entryClient is not set')
          }

          const entryClientContent = ts
            ? entryClientTemplate
            : await transformTSToJS(entryClientPath, entryClientTemplate)

          let overwriteExisting = options.force

          if (!options.force) {
            const prompt = task.prompt(ListrEnquirerPromptAdapter)

            overwriteExisting = await prompt.run({
              type: 'Confirm',
              message: `Overwrite ${entryClientPath}?`,
            })

            if (!overwriteExisting) {
              entryClientPath = entryClientPath.replace(ext, `.new${ext}`)
              task.output =
                `File will be written to ${entryClientPath}\n` +
                `You'll manually need to merge it with your existing entry.client${ext} file.`
            }
          }

          writeFile(entryClientPath, entryClientContent, { overwriteExisting })
        },
      },
      {
        title: `Adding entry.server${ext}...`,
        task: async () => {
          const entryServerTemplate = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'streamingSsr',
              'entry.server.tsx.template',
            ),
            'utf-8',
          )
          // Can't use rwPaths.web.entryServer because it might not be not created yet
          const entryServerPath = path.join(
            cedarPaths.web.src,
            `entry.server${ext}`,
          )
          const entryServerContent = ts
            ? entryServerTemplate
            : await transformTSToJS(entryServerPath, entryServerTemplate)

          writeFile(entryServerPath, entryServerContent, {
            overwriteExisting: options.force,
          })
        },
      },
      {
        title: `Adding Document${ext}...`,
        task: async () => {
          const documentTemplate = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'streamingSsr',
              'Document.tsx.template',
            ),
            'utf-8',
          )
          const documentPath = path.join(cedarPaths.web.src, `Document${ext}`)
          const documentContent = ts
            ? documentTemplate
            : await transformTSToJS(documentPath, documentTemplate)

          writeFile(documentPath, documentContent, {
            overwriteExisting: options.force,
          })
        },
      },
      {
        title: `Update web/{ts,js}config.json...`,
        task: async () => {
          const tsconfigTemplate = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'streamingSsr',
              'tsconfig.json.template',
            ),
            'utf-8',
          )

          const tsconfigPath = path.join(
            cedarPaths.web.base,
            ts ? 'tsconfig.json' : 'jsconfig.json',
          )

          writeFile(tsconfigPath, tsconfigTemplate, {
            overwriteExisting: options.force,
          })
        },
      },
      {
        title:
          'Adding resolution for "@apollo/client-react-streaming/superjson"',
        task: () => {
          // We need this to make sure we get a version of superjson that works
          // with CommonJS.
          // TODO: Remove this when Redwood switches to ESM
          const pkgJsonPath = path.join(cedarPaths.base, 'package.json')
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
          const resolutions: Record<string, string> = pkgJson.resolutions || {}
          resolutions['@apollo/client-react-streaming/superjson'] = '^1.12.2'
          pkgJson.resolutions = resolutions
          fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))
        },
      },
      addWebPackages(['@apollo/client-react-streaming@0.10.0']),
      {
        task: () => {
          printTaskEpilogue(command, description, EXPERIMENTAL_TOPIC_ID)
        },
      },
    ]
  }

  try {
    if (options.verbose) {
      await new Listr(buildTaskData(), {
        exitOnError: true,
        renderer: 'verbose',
      }).run()
    } else {
      await new Listr(
        buildTaskData().map((t) => ({
          ...t,
          rendererOptions: { persistentOutput: true },
        })),
        {
          exitOnError: true,
          rendererOptions: { collapseSubtasks: false },
        },
      ).run()
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    process.exit(exitCode)
  }
}
