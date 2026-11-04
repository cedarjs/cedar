import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { Listr } from 'listr2'
import { coerce, isGreaterThanOrEqual } from 'verkit'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import {
  addRootPackages,
  addWorkspacePackages,
} from '@cedarjs/cli-helpers/packageManager/packages'
import { getConfigPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, writeFile } from '../../lib/index.js'

import {
  command,
  description,
  EXPERIMENTAL_TOPIC_ID,
} from './setupReactCompiler.js'
import { printTaskEpilogue } from './util.js'

interface Opts {
  force: boolean
  verbose?: boolean
}

interface TaskHandle {
  output: string
  skip(message?: string): void
}

/**
 * Returns the `oxc-transform-react` version the project's `@cedarjs/vite`
 * declares as its peer dependency. That's the version Cedar's React plugin is
 * built against, and `oxc-transform-react` is pinned to it, like the rest of
 * Cedar's toolchain.
 */
export function getOxcTransformReactVersion(webBase: string) {
  const webRequire = createRequire(path.join(webBase, 'package.json'))
  const cedarVitePkgJson: unknown = JSON.parse(
    fs.readFileSync(webRequire.resolve('@cedarjs/vite/package.json'), 'utf8'),
  )

  const version =
    typeof cedarVitePkgJson === 'object' &&
    cedarVitePkgJson !== null &&
    'peerDependencies' in cedarVitePkgJson &&
    typeof cedarVitePkgJson.peerDependencies === 'object' &&
    cedarVitePkgJson.peerDependencies !== null &&
    'oxc-transform-react' in cedarVitePkgJson.peerDependencies
      ? cedarVitePkgJson.peerDependencies['oxc-transform-react']
      : undefined

  if (typeof version !== 'string') {
    throw new Error(
      "Your version of @cedarjs/vite doesn't support the React Compiler. " +
        'Please upgrade CedarJS and try again.',
    )
  }

  return version
}

export const handler = async (options: Opts) => {
  const rwPaths = getPaths()
  const configTomlPath = getConfigPath()
  const configFileName = path.basename(configTomlPath)
  const configContent = fs.readFileSync(configTomlPath, 'utf-8')

  function buildTaskData() {
    return [
      {
        title: 'Check prerequisites',
        skip: options.force,
        task: () => {
          // We require vite as that is how we have conditionally integrated the
          // compiler
          if (!rwPaths.web.entryClient || !rwPaths.web.viteConfig) {
            throw new Error(
              'Vite needs to be setup before you can enable React Compiler',
            )
          }

          // Check that the project is using at least react version 19, as
          // required by the compiler
          const webPkgJson = JSON.parse(
            fs.readFileSync(
              path.join(rwPaths.web.base, 'package.json'),
              'utf8',
            ),
          )
          const reactVersion = webPkgJson['dependencies']['react']
          const coercedReactVersion = coerce(reactVersion)
          if (
            !coercedReactVersion ||
            !isGreaterThanOrEqual(coercedReactVersion, '19.0.0')
          ) {
            throw new Error(
              'You need to be using at least React version 19 to enable the React Compiler',
            )
          }
        },
      },
      {
        title: `Adding config to ${configFileName}...`,
        task: (_ctx: unknown, task: TaskHandle) => {
          if (!configContent.includes('[experimental.reactCompiler]')) {
            writeFile(
              configTomlPath,
              configContent.concat(
                '\n[experimental.reactCompiler]\n' +
                  '  enabled = true\n' +
                  '  lintOnly = false\n',
              ),
              {
                overwriteExisting: true, // configuration file always exists
              },
            )
          } else {
            if (options.force) {
              task.output = `Overwriting config in ${configFileName}`

              writeFile(
                configTomlPath,
                configContent.replace(
                  // Enable if it's currently disabled
                  '\n[experimental.reactCompiler]\n  enabled = false\n',
                  '\n[experimental.reactCompiler]\n  enabled = true\n',
                ),
                {
                  overwriteExisting: true, // configuration file always exists
                },
              )
            } else {
              task.skip(
                'The [experimental.reactCompiler] config block already ' +
                  `exists in ${configFileName}.`,
              )
            }
          }
        },
      },
      // We are using two different package manager commands here which is
      // fine because they're operating on different workspaces - web and the
      // root
      {
        title: 'Installing eslint-plugin-react-compiler',
        task: async () => {
          await addRootPackages(['eslint-plugin-react-compiler'], {
            cwd: getPaths().base,
            dev: true,
          })
        },
      },
      {
        title: 'Installing oxc-transform-react',
        task: async () => {
          const version = getOxcTransformReactVersion(rwPaths.web.base)

          await addWorkspacePackages(
            'web',
            [`oxc-transform-react@${version}`],
            {
              cwd: getPaths().base,
              dev: true,
            },
          )
        },
      },
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
