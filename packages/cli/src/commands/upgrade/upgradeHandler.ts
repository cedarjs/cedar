import fs from 'node:fs'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import execa from 'execa'
import latestVersion from 'latest-version'
import { Listr } from 'listr2'
import packageJson, { VersionNotFoundError } from 'package-json'
import { terminalLink } from 'termi-link'

import { colors as c } from '@cedarjs/cli-helpers/colors'
import {
  dedupe,
  dedupeIsSupported,
  install,
  installationErrorMessage,
  prettyPrintCedarCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { getConfig } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { generatePrismaClient } from '../../lib/generatePrismaClient.js'
import { getPaths } from '../../lib/index.js'
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

export const handler = async (upgradeOptions: UpgradeOptions) => {
  const { dryRun, tag, verbose, dedupe, yes, force } = upgradeOptions

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

  /**
   * Whether the tasks that do the actual upgrading are allowed to run.
   *
   * A failed pre-upgrade check normally stops everything after it. `--force`
   * is documented as "Force upgrade even if pre-upgrade checks fail", so it
   * has to get past that — the error is still recorded and printed, it just
   * doesn't hold the upgrade back.
   */
  const notBlockedByPreUpgradeChecks = (ctx: { preUpgradeError?: unknown }) =>
    force || !ctx.preUpgradeError

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
        enabled: (ctx) =>
          !!ctx.versionToUpgradeTo && notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: 'Updating other packages in your package.json(s)',
        task: (ctx) =>
          updatePackageVersionsFromTemplate(ctx, { dryRun, verbose }),
        // Canary only. This forces the template's dependency versions onto the
        // project and adds back any the project is missing, which resurrects
        // packages people have deliberately removed — a project that moved off
        // SQLite gets better-sqlite3 back, for example. That's too blunt for
        // regular upgrades, but people running canary are already signed up
        // for rougher edges.
        // https://github.com/redwoodjs/redwood/pull/8855
        enabled: (ctx) =>
          String(ctx.versionToUpgradeTo).includes('canary') &&
          notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: 'Updating Prisma to the version CedarJS supports',
        // Runs after the canary template sync, so the Prisma versions come
        // from the target release rather than from the template on main
        task: (ctx, task) => updatePrismaDeps(ctx, task, { dryRun, verbose }),
        enabled: (ctx) =>
          !!ctx.versionToUpgradeTo && notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: 'Updating Vite and Vitest to the versions CedarJS uses',
        // Runs after the canary template sync, so the versions come from the
        // target release rather than from the template on main
        task: (ctx, task) => updateViteDeps(ctx, task, { dryRun, verbose }),
        enabled: (ctx) =>
          !!ctx.versionToUpgradeTo && notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: 'Downloading yarn patches',
        task: (ctx) => downloadYarnPatches(ctx, { dryRun, verbose }),
        enabled: (ctx) =>
          String(ctx.versionToUpgradeTo).includes('canary') &&
          notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: 'Removing CLI cache',
        task: () => removeCliCache({ dryRun, verbose }),
        enabled: (ctx) => notBlockedByPreUpgradeChecks(ctx),
      },
      {
        title: `Running ${getPackageManager()} ${install()}`,
        task: () => packageManagerInstall({ verbose }),
        enabled: (ctx) => notBlockedByPreUpgradeChecks(ctx),
        skip: () => !!dryRun,
      },
      {
        title: 'Refreshing the Prisma client',
        task: (_ctx, task) => refreshPrismaClient(task, { verbose }),
        enabled: (ctx) => notBlockedByPreUpgradeChecks(ctx),
        skip: () => !!dryRun,
      },
      {
        title: 'De-duplicating dependencies',
        skip: () => !!dryRun || !dedupe,
        enabled: (ctx) =>
          dedupeIsSupported() && notBlockedByPreUpgradeChecks(ctx),
        task: (_ctx, task) => dedupeDeps(task, { verbose }),
      },
      {
        title: 'One more thing..',
        task: (ctx, task) => {
          const version = ctx.versionToUpgradeTo
          const upgradeMessage = dryRun
            ? `🏃 Dry run complete. Your project would be upgraded to CedarJS ${version}.`
            : `🎉 Your project has been upgraded to CedarJS ${version}!`
          const messageSections = [
            `One more thing...\n\n   ${c.warning(upgradeMessage)} \n\n`,
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
    console.log(`  📣 ${c.info('Pre-upgrade Script Messages:')}`)
    console.log('  ' + preUpgradeMessage.replace(/\n/g, '\n  '))
  }
}

async function packageManagerInstall({ verbose }: { verbose?: boolean }) {
  try {
    await execa(getPackageManager(), [install()], {
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch {
    throw new Error(installationErrorMessage())
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

/**
 * Fetches the registry manifest of `packageName` at `cedarVersion`, from the
 * npm registry the project is configured to use
 */
async function fetchCedarManifest(packageName: string, cedarVersion: string) {
  // Registry metadata doesn't include build metadata, like the `+dd79f1726` in
  // '4.0.0-rc.428+dd79f1726'
  const version = cedarVersion.split('+')[0]

  try {
    return await packageJson(packageName, { version })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Failed to fetch ${packageName}@${version} from the npm registry: ` +
        message,
    )
  }
}

/**
 * Fetches the `prisma` version that `@cedarjs/cli@<cedarVersion>` declares as
 * its peer dependency. Returns `undefined` for CedarJS versions that don't
 * declare `prisma` as a peer.
 */
export async function fetchPrismaPeerVersion(
  cedarVersion: string,
): Promise<string | undefined> {
  const manifest = await fetchCedarManifest('@cedarjs/cli', cedarVersion)
  const prismaVersion = manifest.peerDependencies?.['prisma']

  return typeof prismaVersion === 'string' ? prismaVersion : undefined
}

export interface ViteVersions {
  vite?: string
  vitest?: string
}

/**
 * Fetches the Vite and Vitest versions CedarJS `cedarVersion` is built
 * against: the `vite` dependency of `@cedarjs/vite` and the `vitest` peer
 * dependency of `@cedarjs/testing`. Either is `undefined` when that release
 * doesn't declare it.
 */
export async function fetchViteVersions(
  cedarVersion: string,
): Promise<ViteVersions> {
  const [viteManifest, testingManifest] = await Promise.all([
    fetchCedarManifest('@cedarjs/vite', cedarVersion),
    fetchCedarManifest('@cedarjs/testing', cedarVersion),
  ])

  const vite = viteManifest.dependencies?.['vite']
  const vitest = testingManifest.peerDependencies?.['vitest']

  return {
    vite: typeof vite === 'string' ? vite : undefined,
    vitest: typeof vitest === 'string' ? vitest : undefined,
  }
}

/**
 * Whether `depName` is a Prisma package that's released together with the
 * `prisma` CLI, and so shares its version
 */
function isPrismaReleasePackage(depName: string) {
  return (
    depName === 'prisma' ||
    depName === '@prisma/client' ||
    depName.startsWith('@prisma/adapter-')
  )
}

/**
 * Sets every Prisma package in the `dependencies` and `devDependencies` of
 * `pkg` to `prismaVersion`, collecting a line into `messages` for every change.
 * Only packages `pkg` already declares are updated.
 */
export function updatePrismaDependencies(
  pkg: TemplatePackageJson,
  prismaVersion: string,
  messages: string[],
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean } = {},
) {
  let updated = false

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field] ?? {}

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (!isPrismaReleasePackage(depName) || depVersion === prismaVersion) {
        continue
      }

      if (verbose || dryRun) {
        messages.push(` - ${depName}: ${depVersion} => ${prismaVersion}`)
      }

      deps[depName] = prismaVersion
      updated = true
    }
  }

  return updated
}

/**
 * Makes sure `pkg[field]` declares `depName`, keeping `pkg[field]` sorted, and
 * collects a line into `messages` for every change.
 *
 * A package `pkg` declares in the other section counts as declared, unless
 * `onlyInField` is set. Then it's moved to `pkg[field]`, for packages that
 * production installs, which leave out `devDependencies`, need.
 */
export function addMissingDependency(
  pkg: TemplatePackageJson,
  field: 'dependencies' | 'devDependencies',
  depName: string,
  version: string,
  messages: string[],
  { onlyInField = false }: { onlyInField?: boolean } = {},
) {
  const otherField =
    field === 'dependencies' ? 'devDependencies' : 'dependencies'

  if (pkg[field]?.[depName]) {
    return false
  }

  const otherVersion = pkg[otherField]?.[depName]

  if (otherVersion && !onlyInField) {
    return false
  }

  if (otherVersion) {
    const { [depName]: _moved, ...otherDeps } = pkg[otherField] ?? {}
    pkg[otherField] = otherDeps
    messages.push(` - ${depName}: moved from ${otherField} to ${field}`)
  } else {
    messages.push(` - ${depName}: added at ${version}`)
  }

  const deps = { ...pkg[field], [depName]: otherVersion ?? version }

  pkg[field] = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  )

  return true
}

/**
 * Sets the project's Prisma packages to the version the CedarJS release being
 * upgraded to declares as its `prisma` peer dependency. CedarJS uses the
 * project's copy of Prisma, so the versions need to match, and projects with
 * an api side need `prisma` in the root package.json and `@prisma/client` in
 * the api side's. The step adds them when they're missing.
 */
async function updatePrismaDeps(
  ctx: Record<string, unknown>,
  task: { title: string; skip: (message: string) => void },
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    throw new Error('Failed to upgrade')
  }

  const prismaVersion = await fetchPrismaPeerVersion(
    String(ctx.versionToUpgradeTo),
  )

  if (!prismaVersion) {
    task.skip(
      `CedarJS ${ctx.versionToUpgradeTo} doesn't declare a Prisma version`,
    )
    return
  }

  const messages: string[] = []

  const hasApiSide = fs.existsSync(
    path.join(getPaths().api.base, 'package.json'),
  )
  const projectPackages = [
    {
      basePath: getPaths().base,
      required: {
        field: 'devDependencies',
        depName: 'prisma',
        onlyInField: false,
      },
    },
    {
      basePath: getPaths().api.base,
      // The api side imports the generated Prisma client at runtime
      required: {
        field: 'dependencies',
        depName: '@prisma/client',
        onlyInField: true,
      },
    },
  ] as const

  for (const { basePath, required } of projectPackages) {
    const pkgJsonPath = path.join(basePath, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) {
      continue
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    const pkgMessages: string[] = []

    const added =
      hasApiSide &&
      addMissingDependency(
        pkg,
        required.field,
        required.depName,
        prismaVersion,
        pkgMessages,
        { onlyInField: required.onlyInField },
      )
    const updated = updatePrismaDependencies(pkg, prismaVersion, pkgMessages, {
      dryRun,
      verbose,
    })

    if (added || updated) {
      if (pkgMessages.length > 0) {
        messages.push(`Updating ${pkgJsonPath}`, ...pkgMessages)
      }

      if (!dryRun) {
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, undefined, 2))
      }
    }
  }

  if (messages.length > 0) {
    task.title = task.title + '\n' + messages.join('\n')
  }
}

/**
 * Returns the `@vitest/*` packages among `depNames` that are published at
 * `vitestVersion`, and so are released together with `vitest`. Other
 * `@vitest/*` packages, like `@vitest/eslint-plugin`, have versions of their
 * own, and not every Vitest release publishes every package in the scope.
 */
export async function fetchVitestReleasePackages(
  depNames: Iterable<string>,
  vitestVersion: string,
): Promise<Set<string>> {
  const candidates = [...new Set(depNames)].filter((depName) =>
    depName.startsWith('@vitest/'),
  )

  const published = await Promise.all(
    candidates.map(async (depName) => {
      try {
        await packageJson(depName, { version: vitestVersion })
        return true
      } catch (e) {
        if (e instanceof VersionNotFoundError) {
          return false
        }

        const message = e instanceof Error ? e.message : String(e)
        throw new Error(
          `Failed to fetch ${depName}@${vitestVersion} from the npm ` +
            'registry: ' +
            message,
        )
      }
    }),
  )

  return new Set(candidates.filter((_, i) => published[i]))
}

interface ProjectPackageJson extends TemplatePackageJson {
  resolutions?: Record<string, unknown>
  overrides?: Record<string, unknown>
}

/**
 * Sets `vite`, `vitest` and the `vitestPackages` in the `dependencies` and
 * `devDependencies` of `pkg` to `versions`, and the `vite` pin in its
 * `resolutions` (Yarn) or `overrides` (npm). Collects a line into `messages`
 * for every change. Only packages and pins `pkg` already declares are
 * updated.
 *
 * `vitestPackages` are the `@vitest/*` packages released together with
 * `vitest`, as returned by `fetchVitestReleasePackages`.
 */
export function updateViteDependencies(
  pkg: ProjectPackageJson,
  versions: ViteVersions,
  messages: string[],
  {
    dryRun,
    verbose,
    vitestPackages = new Set(),
  }: {
    dryRun?: boolean
    verbose?: boolean
    vitestPackages?: ReadonlySet<string>
  } = {},
) {
  const versionFor = (depName: string) => {
    if (depName === 'vite') {
      return versions.vite
    }

    if (depName === 'vitest' || vitestPackages.has(depName)) {
      return versions.vitest
    }

    return undefined
  }

  let updated = false

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field] ?? {}

    for (const [depName, depVersion] of Object.entries(deps)) {
      const version = versionFor(depName)

      if (!version || depVersion === version) {
        continue
      }

      if (verbose || dryRun) {
        messages.push(` - ${depName}: ${depVersion} => ${version}`)
      }

      deps[depName] = version
      updated = true
    }
  }

  for (const field of ['resolutions', 'overrides'] as const) {
    const pin = pkg[field]?.['vite']

    // npm overrides can also be objects, which pin nested dependencies.
    // Only a top-level version string pins the project's own Vite.
    if (!versions.vite || typeof pin !== 'string' || pin === versions.vite) {
      continue
    }

    if (verbose || dryRun) {
      messages.push(` - ${field}.vite: ${pin} => ${versions.vite}`)
    }

    pkg[field] = { ...pkg[field], vite: versions.vite }
    updated = true
  }

  return updated
}

/**
 * Returns `content`, a pnpm-workspace.yaml, with the `vite` entry in its
 * top-level `overrides` set to `viteVersion`. Returns `undefined` when there's
 * no such entry, or it's already on `viteVersion`.
 *
 * Edits the text line by line rather than parsing the YAML, so comments and
 * formatting in the rest of the file stay as they are.
 */
export function updatePnpmViteOverride(content: string, viteVersion: string) {
  const lines = content.split('\n')
  const overridesIndex = lines.findIndex((line) =>
    /^overrides:\s*(#[^\n]*)?$/.test(line),
  )

  if (overridesIndex === -1) {
    return undefined
  }

  for (let i = overridesIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    // The block ends at the next top-level key. Comments can start at any
    // column.
    if (/^[^\s#]/.test(line)) {
      break
    }

    // `rest` keeps the `\r` of a CRLF line ending
    const match =
      /^(\s+)(['"]?)vite\2(\s*:\s*)(['"]?)([^'"\s#]+)\4([^\n]*)$/.exec(line)

    if (!match) {
      continue
    }

    const [, indent, keyQuote, separator, valueQuote, version, rest] = match

    if (version === viteVersion) {
      return undefined
    }

    lines[i] =
      indent +
      keyQuote +
      'vite' +
      keyQuote +
      separator +
      valueQuote +
      viteVersion +
      valueQuote +
      rest

    return lines.join('\n')
  }

  return undefined
}

/**
 * Sets the project's Vite and Vitest packages to the versions the CedarJS
 * release being upgraded to is built against. The CedarJS Vite plugins only
 * work with the exact Vite version they're built against, and the `@vitest/*`
 * packages have to match `vitest`. Both sides use Vite to build, so the step
 * adds `vite` to the web and api sides when it's missing. `vitest` is only
 * updated, because a project that doesn't run tests doesn't need it.
 */
async function updateViteDeps(
  ctx: Record<string, unknown>,
  task: { title: string; skip: (message: string) => void },
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    throw new Error('Failed to upgrade')
  }

  const versions = await fetchViteVersions(String(ctx.versionToUpgradeTo))

  if (!versions.vite && !versions.vitest) {
    task.skip(
      `CedarJS ${ctx.versionToUpgradeTo} doesn't declare Vite or Vitest ` +
        'versions',
    )
    return
  }

  const messages: string[] = []

  const projectPackages = [
    { basePath: getPaths().base, requiresVite: false },
    { basePath: getPaths().web.base, requiresVite: true },
    { basePath: getPaths().api.base, requiresVite: true },
  ]

  const projectPackageJsons = projectPackages
    .map(({ basePath, requiresVite }) => ({
      pkgJsonPath: path.join(basePath, 'package.json'),
      requiresVite,
    }))
    .filter(({ pkgJsonPath }) => fs.existsSync(pkgJsonPath))
    .map(({ pkgJsonPath, requiresVite }) => ({
      pkgJsonPath,
      requiresVite,
      pkg: JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')),
    }))

  const vitestPackages = versions.vitest
    ? await fetchVitestReleasePackages(
        projectPackageJsons.flatMap(({ pkg }) => [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ]),
        versions.vitest,
      )
    : new Set<string>()

  for (const { pkgJsonPath, requiresVite, pkg } of projectPackageJsons) {
    const pkgMessages: string[] = []

    const added =
      requiresVite &&
      !!versions.vite &&
      addMissingDependency(
        pkg,
        'devDependencies',
        'vite',
        versions.vite,
        pkgMessages,
      )
    const updated = updateViteDependencies(pkg, versions, pkgMessages, {
      dryRun,
      verbose,
      vitestPackages,
    })

    if (added || updated) {
      if (pkgMessages.length > 0) {
        messages.push(`Updating ${pkgJsonPath}`, ...pkgMessages)
      }

      if (!dryRun) {
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, undefined, 2))
      }
    }
  }

  const pnpmWorkspacePath = path.join(getPaths().base, 'pnpm-workspace.yaml')

  if (versions.vite && fs.existsSync(pnpmWorkspacePath)) {
    const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8')
    const updatedContent = updatePnpmViteOverride(content, versions.vite)

    if (updatedContent !== undefined) {
      if (verbose || dryRun) {
        messages.push(
          `Updating ${pnpmWorkspacePath}`,
          ` - overrides.vite => ${versions.vite}`,
        )
      }

      if (!dryRun) {
        fs.writeFileSync(pnpmWorkspacePath, updatedContent)
      }
    }
  }

  if (messages.length > 0) {
    task.title = task.title + '\n' + messages.join('\n')
  }
}

interface TemplatePackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Copies one section (`dependencies` or `devDependencies`) of the app
 * template's package.json into the project's own, pinning each package to the
 * template's version and collecting a line into `messages` for every change.
 *
 * CedarJS packages are skipped. The earlier "Updating your CedarJS version"
 * task owns the ones the project already has, and ones it doesn't have can't
 * be handled from this comparison at all: a package missing from the project
 * looks exactly like one the user deliberately removed.
 */
export function mergeTemplateDependencies(
  field: 'dependencies' | 'devDependencies',
  templatePackageJson: TemplatePackageJson,
  localPackageJson: TemplatePackageJson,
  messages: string[],
  { dryRun, verbose }: { dryRun?: boolean; verbose?: boolean } = {},
) {
  const templateDeps = templatePackageJson[field]

  if (!templateDeps) {
    return
  }

  for (const [depName, depVersion] of Object.entries(templateDeps)) {
    if (depName.startsWith('@cedarjs/')) {
      continue
    }

    const localDeps = (localPackageJson[field] ??= {})

    if (verbose || dryRun) {
      messages.push(` - ${depName}: ${localDeps[depName]} => ${depVersion}`)
    }

    localDeps[depName] = depVersion
  }
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
          if (!res.ok) {
            throw new Error(
              `Failed to fetch template package.json from ${url}: ` +
                res.statusText,
            )
          }
          const text = await res.text()
          const templatePackageJson = JSON.parse(text)

          const localPackageJsonText = fs.readFileSync(pkgJsonPath, 'utf-8')
          const localPackageJson = JSON.parse(localPackageJsonText)

          const messages: string[] = []

          for (const field of ['dependencies', 'devDependencies'] as const) {
            mergeTemplateDependencies(
              field,
              templatePackageJson,
              localPackageJson,
              messages,
              { dryRun, verbose },
            )
          }

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

  const url =
    'https://api.github.com/repos/cedarjs/cedar/git/trees/main?recursive=1'
  const res = await fetch(url, {
    headers: {
      ...(githubToken && { Authorization: `Bearer ${githubToken}` }),
      ['X-GitHub-Api-Version']: '2022-11-28',
      Accept: 'application/vnd.github+json',
    },
  })

  if (!res.ok) {
    throw new Error(
      `Failed to fetch list of yarn patches from ${url}: ` + res.statusText,
    )
  }
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
          if (!res.ok) {
            throw new Error(
              `Failed to fetch patch metadata from ${patch.url}: ` +
                res.statusText,
            )
          }
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
    await generatePrismaClient({ verbose, force: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    task.skip('Refreshing the Prisma client caused an Error.')
    console.log(
      'You may need to update your prisma client manually: $ ' +
        prettyPrintCedarCommand(['prisma', 'generate']),
    )
    console.log(c.error(message))
  }
}

async function dedupeDeps(_task: unknown, { verbose }: { verbose?: boolean }) {
  const dedupeCmd = dedupe()

  // I could have/should have used `dedupeIsSupported()` but that doesn't make
  // it as obvious that we'll never try to execute `pnpm undefined` or print an
  // error message with `npm undefined`
  if (!dedupeCmd) {
    return
  }

  try {
    await execa(getPackageManager(), [dedupeCmd], {
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch (e) {
    // ExecaError is an instance of Error
    const message = e instanceof Error ? e.message : String(e)
    console.log(c.error(message))

    throw new Error(
      `Could not finish de-duplication. Please run \`${getPackageManager()} ` +
        `${dedupeCmd}\` before continuing`,
    )
  }

  await packageManagerInstall({ verbose })
}
