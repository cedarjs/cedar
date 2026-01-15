import fs from 'node:fs'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import execa from 'execa'
import latestVersion from 'latest-version'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getConfig } from '@cedarjs/project-config'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { generatePrismaClient } from '../../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'
// @ts-expect-error - Types not available for JS files
import { PLUGIN_CACHE_FILENAME } from '../../lib/plugin.js'

import { runPreUpgradeScripts } from './preUpgradeScripts.js'
import { isValidCedarJSTag } from './tags.js'

export interface UpgradeOptions {
  dryRun?: boolean
  tag?: string
  verbose?: boolean
  dedupe?: boolean
  yes?: boolean
  force?: boolean
}

export const handler = async ({
  dryRun,
  tag,
  verbose,
  dedupe,
  yes,
  force,
}: UpgradeOptions) => {
  recordTelemetryAttributes({
    command: 'upgrade',
    dryRun: !!dryRun,
    tag: tag ?? 'latest',
    verbose: !!verbose,
    dedupe: !!dedupe,
    yes: !!yes,
    force: !!force,
  })

  let preUpgradeMessage = ''
  let preUpgradeError = ''

  // structuring as nested tasks to avoid bug with task.title causing duplicates
  const tasks = new Listr(
    [
      {
        title: 'Confirm upgrade',
        task: async (_ctx, task) => {
          if (yes) {
            task.skip('Skipping confirmation prompt because of --yes flag.')
            return
          }

          if (tag) {
            task.skip(
              'Skipping confirmation prompt because a specific tag is ' +
                'specified.',
            )
            return
          }

          const prompt = task.prompt(ListrEnquirerPromptAdapter)
          const proceed = await prompt.run({
            type: 'Confirm',
            message:
              'This will upgrade your CedarJS project to the latest version. Do you want to proceed?',
            initial: 'Y',
            default: '(Yes/no)',
            format: function (
              // Enquirer state is not easily typed here, and 'this' is used
              // to access it.
              this: any,
              value: unknown,
            ) {
              if (this.state.submitted) {
                return this.isTrue(value) ? 'yes' : 'no'
              }

              return 'Yes'
            },
          })
          if (!proceed) {
            task.skip('Upgrade cancelled by user.')
            process.exit(0)
          }
        },
      },
      {
        title: 'Checking latest version',
        task: async (ctx) => setLatestVersionToContext(ctx, tag, verbose),
      },
      {
        title: 'Running pre-upgrade scripts',
        task: async (ctx, task) => {
          await runPreUpgradeScripts(ctx, task, { verbose, force })

          if (ctx.preUpgradeMessage) {
            preUpgradeMessage = String(ctx.preUpgradeMessage)
          }

          if (ctx.preUpgradeError) {
            preUpgradeError = String(ctx.preUpgradeError)
          }
        },
        enabled: (ctx) => !!ctx.versionToUpgradeTo,
      },
      {
        title: 'Updating your CedarJS version',
        task: (ctx) => updateCedarJSDepsForAllSides(ctx, { dryRun, verbose }),
        enabled: (ctx) => !!ctx.versionToUpgradeTo && !ctx.preUpgradeError,
      },
      {
        title: 'Updating other packages in your package.json(s)',
        task: (ctx) =>
          updatePackageVersionsFromTemplate(ctx, { dryRun, verbose }),
        enabled: (ctx) =>
          String(ctx.versionToUpgradeTo).includes('canary') &&
          !ctx.preUpgradeError,
      },
      {
        title: 'Downloading yarn patches',
        task: (ctx) => downloadYarnPatches(ctx, { dryRun, verbose }),
        enabled: (ctx) =>
          String(ctx.versionToUpgradeTo).includes('canary') &&
          !ctx.preUpgradeError,
      },
      {
        title: 'Removing CLI cache',
        task: () => removeCliCache({ dryRun, verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
      },
      {
        title: 'Running yarn install',
        task: () => yarnInstall({ verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
        skip: () => !!dryRun,
      },
      {
        title: 'Refreshing the Prisma client',
        task: (_ctx, task) => refreshPrismaClient(task, { verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
        skip: () => !!dryRun,
      },
      {
        title: 'De-duplicating dependencies',
        skip: () => !!dryRun || !dedupe,
        enabled: (ctx) => !ctx.preUpgradeError,
        task: (_ctx, task) => dedupeDeps(task, { verbose }),
      },
      {
        title: 'One more thing..',
        task: (ctx, task) => {
          const version = ctx.versionToUpgradeTo
          const messageSections = [
            `One more thing...\n\n   ${c.warning(
              `🎉 Your project has been upgraded to CedarJS ${version}!`,
            )} \n\n`,
          ]
          // Show links when switching to 'latest' or 'rc', undefined is essentially an alias of 'latest'
          if ([undefined, 'latest', 'rc'].includes(tag)) {
            const ghReleasesLink = terminalLink(
              `GitHub Release notes`,
              // intentionally not linking to specific version
              `https://github.com/cedarjs/cedar/releases`,
            )
            const discordLink = terminalLink(
              `Discord`,
              `https://cedarjs.com/discord`,
            )

            messageSections.push(
              '   Please review the release notes for any manual steps:\n' +
                `   ❖ ${ghReleasesLink}\n` +
                '   Join our Discord community if you have any questions or need support:\n' +
                `   ❖ ${discordLink}\n`,
            )
          }

          // @MARK
          // This should be temporary and eventually superseded by a more generic notification system
          if (tag) {
            const additionalMessages = []
            // Reminder to update the `notifications.versionUpdates` TOML option
            if (
              !getConfig().notifications.versionUpdates.includes(tag) &&
              isValidCedarJSTag(tag)
            ) {
              additionalMessages.push(
                `   ❖ You may want to update your cedar.toml (or redwood.toml) so that \`notifications.versionUpdates\` includes "${tag}"\n`,
              )
            }
            // Append additional messages with a header
            if (additionalMessages.length > 0) {
              messageSections.push(
                `   📢 ${c.warning(`We'd also like to remind you that:`)} \n`,
                ...additionalMessages,
              )
            }
          }
          task.title = messageSections.join('').trimEnd()
        },
      },
    ],
    {
      renderer: verbose ? 'verbose' : 'default',
      rendererOptions: { collapseSubtasks: false },
    },
  )

  await tasks.run()

  if (preUpgradeError) {
    console.error('')
    console.error(`  🚨 ${c.error('Pre-upgrade Error:')}`)
    console.error('  ' + preUpgradeError.replace(/\n/g, '\n  '))

    if (!force) {
      process.exit(1)
    }
  }

  if (preUpgradeMessage) {
    console.log('')
    console.log(`  📣 ${c.info('Pre-upgrade Message:')}`)
    console.log('  ' + preUpgradeMessage.replace(/\n/g, '\n  '))
  }
}

async function yarnInstall({ verbose }: { verbose?: boolean }) {
  try {
    await execa('yarn install', {
      shell: true,
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch {
    throw new Error(
      'Could not finish installation. Please run `yarn install` and then `yarn dedupe`, before continuing',
    )
  }
}

/**
 * Removes the CLI plugin cache. This prevents the CLI from using outdated
 * versions of the plugin, when the plugins share the same alias. e.g.
 * `cedar sb` used to point to `@cedarjs/cli-storybook` but now points to
 * `@cedarjs/cli-storybook-vite`
 */
async function removeCliCache({
  dryRun,
  verbose,
}: {
  dryRun?: boolean
  verbose?: boolean
}) {
  const cliCacheDir = path.join(
    getPaths().generated.base,
    PLUGIN_CACHE_FILENAME,
  )

  if (verbose) {
    console.log('Removing CLI cache at: ', cliCacheDir)
  }

  if (!dryRun) {
    fs.rmSync(cliCacheDir, { recursive: true, force: true })
  }
}

function isErrorWithNestedCode(error: unknown, code: string): boolean {
  return (
    error instanceof Object &&
    (('code' in error && error.code === code) ||
      ('cause' in error && isErrorWithNestedCode(error.cause, code)))
  )
}

async function setLatestVersionToContext(
  ctx: Record<string, unknown>,
  tag?: string,
  verbose?: boolean,
) {
  try {
    const foundVersion = await latestVersion(
      '@cedarjs/core',
      tag ? { version: tag } : {},
    )

    ctx.versionToUpgradeTo = foundVersion
    return foundVersion
  } catch (error) {
    if (verbose) {
      console.error(error)
    }

    const proxyError = isErrorWithNestedCode(error, 'ENOTFOUND')
      ? '\n\nIf you are behind a proxy, please set the relevant proxy ' +
        'environment variables.\nSee here for more information: ' +
        'https://nodejs.org/api/http.html#built-in-proxy-support\n'
      : ''

    if (tag) {
      throw new Error(`Could not find the latest '${tag}' version${proxyError}`)
    }

    throw new Error(`Could not find the latest version${proxyError}`)
  }
}

/**
 * Iterates over CedarJS dependencies in package.json files and updates the
 * version.
 */
function updatePackageJsonVersion(
  pkgPath: string,
  version: string,
  task: { title: string },
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean },
) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'),
  )

  const messages: string[] = []

  if (pkg.dependencies) {
    for (const depName of Object.keys(pkg.dependencies).filter(
      (x) => x.startsWith('@cedarjs/') && x !== '@cedarjs/studio',
    )) {
      if (verbose || dryRun) {
        messages.push(
          ` - ${depName}: ${pkg.dependencies[depName]} => ${version}`,
        )
      }

      pkg.dependencies[depName] = `${version}`
    }
  }

  if (pkg.devDependencies) {
    for (const depName of Object.keys(pkg.devDependencies).filter(
      (x) => x.startsWith('@cedarjs/') && x !== '@cedarjs/studio',
    )) {
      if (verbose || dryRun) {
        messages.push(
          ` - ${depName}: ${pkg.devDependencies[depName]} => ${version}`,
        )
      }

      pkg.devDependencies[depName] = `${version}`
    }
  }

  if (messages.length > 0) {
    task.title = task.title + '\n' + messages.join('\n')
  }

  if (!dryRun) {
    fs.writeFileSync(
      path.join(pkgPath, 'package.json'),
      JSON.stringify(pkg, undefined, 2),
    )
  }
}

function updateCedarJSDepsForAllSides(
  ctx: Record<string, unknown>,
  options: { dryRun?: boolean; verbose?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    throw new Error('Failed to upgrade')
  }

  const updatePaths = [
    getPaths().base,
    getPaths().api.base,
    getPaths().web.base,
  ]

  return new Listr(
    updatePaths.map((basePath) => {
      const pkgJsonPath = path.join(basePath, 'package.json')
      return {
        title: `Updating ${pkgJsonPath}`,
        task: (_ctx: unknown, task: { title: string }) =>
          updatePackageJsonVersion(
            basePath,
            String(ctx.versionToUpgradeTo),
            task,
            options,
          ),
        skip: () => !fs.existsSync(pkgJsonPath),
      }
    }),
  )
}

async function updatePackageVersionsFromTemplate(
  ctx: Record<string, unknown>,
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    throw new Error('Failed to upgrade')
  }

  const packageJsons = [
    {
      basePath: getPaths().base,
      url: 'https://raw.githubusercontent.com/cedarjs/cedar/main/packages/create-cedar-app/templates/ts/package.json',
    },
    {
      basePath: getPaths().api.base,
      url: 'https://raw.githubusercontent.com/cedarjs/cedar/main/packages/create-cedar-app/templates/ts/api/package.json',
    },
    {
      basePath: getPaths().web.base,
      url: 'https://raw.githubusercontent.com/cedarjs/cedar/main/packages/create-cedar-app/templates/ts/web/package.json',
    },
  ]

  return new Listr(
    packageJsons.map(({ basePath, url }) => {
      const pkgJsonPath = path.join(basePath, 'package.json')

      return {
        title: `Updating ${pkgJsonPath}`,
        task: async (_ctx: unknown, task: { title: string }) => {
          const res = await fetch(url)
          const text = await res.text()
          const templatePackageJson = JSON.parse(text)

          const localPackageJsonText = fs.readFileSync(pkgJsonPath, 'utf-8')
          const localPackageJson = JSON.parse(localPackageJsonText)

          const messages: string[] = []

          Object.entries(templatePackageJson.dependencies || {}).forEach(
            ([depName, depVersion]: [string, unknown]) => {
              // CedarJS packages are handled in another task
              if (!depName.startsWith('@cedarjs/')) {
                if (verbose || dryRun) {
                  messages.push(
                    ` - ${depName}: ${localPackageJson.dependencies[depName]} => ${depVersion}`,
                  )
                }

                localPackageJson.dependencies[depName] = depVersion
              }
            },
          )

          Object.entries(templatePackageJson.devDependencies || {}).forEach(
            ([depName, depVersion]: [string, unknown]) => {
              // CedarJS packages are handled in another task
              if (!depName.startsWith('@cedarjs/')) {
                if (verbose || dryRun) {
                  messages.push(
                    ` - ${depName}: ${localPackageJson.devDependencies[depName]} => ${depVersion}`,
                  )
                }

                localPackageJson.devDependencies[depName] = depVersion
              }
            },
          )

          if (messages.length > 0) {
            task.title = task.title + '\n' + messages.join('\n')
          }

          if (!dryRun) {
            fs.writeFileSync(
              pkgJsonPath,
              JSON.stringify(localPackageJson, null, 2),
            )
          }
        },
        skip: () => !fs.existsSync(pkgJsonPath),
      }
    }),
  )
}

async function downloadYarnPatches(
  ctx: Record<string, unknown>,
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    throw new Error('Failed to upgrade')
  }

  const githubToken =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.REDWOOD_GITHUB_TOKEN

  const res = await fetch(
    'https://api.github.com/repos/cedarjs/cedar/git/trees/main?recursive=1',
    {
      headers: {
        ...(githubToken && { Authorization: `Bearer ${githubToken}` }),
        ['X-GitHub-Api-Version']: '2022-11-28',
        Accept: 'application/vnd.github+json',
      },
    },
  )

  const json = await res.json()
  const patches: { path: string; url: string }[] = json.tree?.filter(
    (patchInfo: { path: string }) =>
      patchInfo.path.startsWith(
        'packages/create-cedar-app/templates/ts/.yarn/patches/',
      ),
  )

  const patchDir = path.join(getPaths().base, '.yarn', 'patches')

  if (verbose) {
    console.log('Creating patch directory', patchDir)
  }

  if (!dryRun) {
    fs.mkdirSync(patchDir, { recursive: true })
  }

  return new Listr(
    (patches || []).map((patch) => {
      return {
        title: `Downloading ${patch.path}`,
        task: async () => {
          const res = await fetch(patch.url)
          const patchMeta = await res.json()
          const patchPath = path.join(
            getPaths().base,
            '.yarn',
            'patches',
            path.basename(patch.path),
          )

          if (verbose) {
            console.log('Writing patch', patchPath)
          }

          if (!dryRun) {
            await fs.promises.writeFile(patchPath, patchMeta.content, 'base64')
          }
        },
      }
    }),
  )
}

async function refreshPrismaClient(
  task: { skip: (msg: string) => void },
  { verbose }: { verbose?: boolean },
) {
  // Relates to prisma/client issue
  // See: https://github.com/redwoodjs/redwood/issues/1083
  try {
    await generatePrismaClient({ verbose, force: false })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    task.skip('Refreshing the Prisma client caused an Error.')
    console.log(
      'You may need to update your prisma client manually: $ yarn cedar prisma generate',
    )
    console.log(c.error(message))
  }
}

const dedupeDeps = async (
  _task: unknown,
  { verbose }: { verbose?: boolean },
) => {
  try {
    await execa('yarn dedupe', {
      shell: true,
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch (e) {
    // ExecaError is an instance of Error
    const message = e instanceof Error ? e.message : String(e)
    console.log(c.error(message))

    throw new Error(
      'Could not finish de-duplication. Please run `yarn dedupe` before ' +
        'continuing',
    )
  }

  await yarnInstall({ verbose })
}
