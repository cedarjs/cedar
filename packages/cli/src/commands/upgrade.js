import fs from 'node:fs'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import execa from 'execa'
import latestVersion from 'latest-version'
import { Listr } from 'listr2'
import semver from 'semver'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getConfig } from '@cedarjs/project-config'

import c from '../lib/colors.js'
import { generatePrismaClient } from '../lib/generatePrismaClient.js'
import { getPaths } from '../lib/index.js'
import { PLUGIN_CACHE_FILENAME } from '../lib/plugin.js'

export const command = 'upgrade'
export const description = 'Upgrade all @cedarjs packages via interactive CLI'

export const builder = (yargs) => {
  yargs
    .example(
      'cedar upgrade -t 0.20.1-canary.5',
      'Specify a version. URL for Version History:\n' +
        'https://www.npmjs.com/package/@cedarjs/core',
    )
    .option('dry-run', {
      alias: 'd',
      description: 'Check for outdated packages without upgrading',
      type: 'boolean',
    })
    .option('tag', {
      alias: 't',
      description:
        '[choices: "latest", "rc", "next", "canary", "experimental", or a ' +
        'specific-version (see example below)] WARNING: "canary", "rc" and ' +
        '"experimental" are unstable releases! And "canary" releases include ' +
        'breaking changes often requiring changes to your codebase when ' +
        'upgrading a project.',
      requiresArg: true,
      type: 'string',
      coerce: validateTag,
    })
    .option('verbose', {
      alias: 'v',
      description: 'Print verbose logs',
      type: 'boolean',
      default: false,
    })
    .option('dedupe', {
      description: 'Skip dedupe check with --no-dedupe',
      type: 'boolean',
      default: true,
    })
    .option('yes', {
      alias: 'y',
      describe: 'Skip prompts and use defaults',
      default: false,
      type: 'boolean',
    })
    .option('force', {
      alias: 'f',
      describe: 'Force upgrade even if pre-upgrade checks fail',
      default: false,
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference for the upgrade command',
        'https://cedarjs.com/docs/cli-commands#upgrade',
      )}.\nAnd the ${terminalLink(
        'GitHub releases page',
        'https://github.com/cedarjs/cedar/releases',
      )} for more information on the current release.`,
    )
}

// Used in yargs builder to coerce tag AND to parse yarn version
const SEMVER_REGEX =
  /(?<=^v?|\sv?)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*)(?:\.(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*))*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?(?=$|\s)/i

const isValidSemver = (string) => {
  return SEMVER_REGEX.test(string)
}

const isValidCedarJSTag = (tag) => {
  return ['rc', 'canary', 'latest', 'next', 'experimental'].includes(tag)
}

export const validateTag = (tag) => {
  const isTagValid = isValidSemver(tag) || isValidCedarJSTag(tag)

  if (!isTagValid) {
    // Stop execution
    throw new Error(
      c.error(
        "Invalid tag supplied. Supported values: 'rc', 'canary', 'latest', 'next', 'experimental', or a valid semver version\n",
      ),
    )
  }

  return tag
}

export const handler = async ({ dryRun, tag, verbose, dedupe, yes, force }) => {
  recordTelemetryAttributes({
    command: 'upgrade',
    dryRun,
    tag,
    verbose,
    dedupe,
    yes,
    force,
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
            format: function (value) {
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
        task: async (ctx) => setLatestVersionToContext(ctx, tag),
      },
      {
        title: 'Running pre-upgrade scripts',
        task: async (ctx, task) => {
          await runPreUpgradeScripts(ctx, task, { verbose, force })

          if (ctx.preUpgradeMessage) {
            preUpgradeMessage = ctx.preUpgradeMessage
          }

          if (ctx.preUpgradeError) {
            preUpgradeError = ctx.preUpgradeError
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
          ctx.versionToUpgradeTo?.includes('canary') && !ctx.preUpgradeError,
      },
      {
        title: 'Downloading yarn patches',
        task: (ctx) => downloadYarnPatches(ctx, { dryRun, verbose }),
        enabled: (ctx) =>
          ctx.versionToUpgradeTo?.includes('canary') && !ctx.preUpgradeError,
      },
      {
        title: 'Removing CLI cache',
        task: (ctx) => removeCliCache(ctx, { dryRun, verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
      },
      {
        title: 'Running yarn install',
        task: (ctx) => yarnInstall(ctx, { dryRun, verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
        skip: () => dryRun,
      },
      {
        title: 'Refreshing the Prisma client',
        task: (_ctx, task) => refreshPrismaClient(task, { verbose }),
        enabled: (ctx) => !ctx.preUpgradeError,
        skip: () => dryRun,
      },
      {
        title: 'De-duplicating dependencies',
        skip: () => dryRun || !dedupe,
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
              `https://github.com/cedarjs/cedar/releases`, // intentionally not linking to specific version
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
                `   ❖ You may want to update your redwood.toml config so that \`notifications.versionUpdates\` includes "${tag}"\n`,
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
    console.error(`   ❌ ${c.error('Pre-upgrade Error:')}\n`)
    console.error('  ' + preUpgradeError.replace(/\n/g, '\n   '))

    if (!force) {
      process.exit(1)
    }
  }

  if (preUpgradeMessage) {
    console.log('')
    console.log(`   📣 ${c.info('Pre-upgrade Message:')}\n`)
    console.log('  ' + preUpgradeMessage.replace(/\n/g, '\n   '))
  }
}

async function yarnInstall({ verbose }) {
  try {
    await execa('yarn install', {
      shell: true,
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch (e) {
    throw new Error(
      'Could not finish installation. Please run `yarn install` and then `yarn dedupe`, before continuing',
    )
  }
}

/**
 * Removes the CLI plugin cache. This prevents the CLI from using outdated versions of the plugin,
 * when the plugins share the same alias. e.g. `cedar sb` used to point to `@cedarjs/cli-storybook` but now points to `@cedarjs/cli-storybook-vite`
 */
async function removeCliCache(ctx, { dryRun, verbose }) {
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

async function setLatestVersionToContext(ctx, tag) {
  try {
    const foundVersion = await latestVersion(
      '@cedarjs/core',
      tag ? { version: tag } : {},
    )

    ctx.versionToUpgradeTo = foundVersion
    return foundVersion
  } catch (e) {
    if (tag) {
      throw new Error('Could not find the latest `' + tag + '` version')
    }

    throw new Error('Could not find the latest version')
  }
}

/**
 * Iterates over CedarJS dependencies in package.json files and updates the
 * version.
 */
function updatePackageJsonVersion(pkgPath, version, task, { dryRun, verbose }) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'),
  )

  const messages = []

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

function updateCedarJSDepsForAllSides(ctx, options) {
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
        task: (_ctx, task) =>
          updatePackageJsonVersion(
            basePath,
            ctx.versionToUpgradeTo,
            task,
            options,
          ),
        skip: () => !fs.existsSync(pkgJsonPath),
      }
    }),
  )
}

async function updatePackageVersionsFromTemplate(ctx, { dryRun, verbose }) {
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
        task: async () => {
          const res = await fetch(url)
          const text = await res.text()
          const templatePackageJson = JSON.parse(text)

          const localPackageJsonText = fs.readFileSync(pkgJsonPath, 'utf-8')
          const localPackageJson = JSON.parse(localPackageJsonText)

          Object.entries(templatePackageJson.dependencies || {}).forEach(
            ([depName, depVersion]) => {
              // CedarJS packages are handled in another task
              if (!depName.startsWith('@cedarjs/')) {
                if (verbose || dryRun) {
                  console.log(
                    ` - ${depName}: ${localPackageJson.dependencies[depName]} => ${depVersion}`,
                  )
                }

                localPackageJson.dependencies[depName] = depVersion
              }
            },
          )

          Object.entries(templatePackageJson.devDependencies || {}).forEach(
            ([depName, depVersion]) => {
              // CedarJS packages are handled in another task
              if (!depName.startsWith('@cedarjs/')) {
                if (verbose || dryRun) {
                  console.log(
                    ` - ${depName}: ${localPackageJson.devDependencies[depName]} => ${depVersion}`,
                  )
                }

                localPackageJson.devDependencies[depName] = depVersion
              }
            },
          )

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

async function downloadYarnPatches(ctx, { dryRun, verbose }) {
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
        Authorization: githubToken ? `Bearer ${githubToken}` : undefined,
        ['X-GitHub-Api-Version']: '2022-11-28',
        Accept: 'application/vnd.github+json',
      },
    },
  )

  const json = await res.json()
  const patches = json.tree?.filter((patchInfo) =>
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

async function refreshPrismaClient(task, { verbose }) {
  // Relates to prisma/client issue
  // See: https://github.com/redwoodjs/redwood/issues/1083
  try {
    await generatePrismaClient({
      verbose,
      force: false,
    })
  } catch (e) {
    task.skip('Refreshing the Prisma client caused an Error.')
    console.log(
      'You may need to update your prisma client manually: $ yarn cedar prisma generate',
    )
    console.log(c.error(e.message))
  }
}

const dedupeDeps = async (_task, { verbose }) => {
  try {
    await execa('yarn dedupe', {
      shell: true,
      stdio: verbose ? 'inherit' : 'pipe',
      cwd: getPaths().base,
    })
  } catch (e) {
    console.log(c.error(e.message))
    throw new Error(
      'Could not finish de-duplication. For yarn 1.x, please run `npx yarn-deduplicate`, or for yarn >= 3 run `yarn dedupe` before continuing',
    )
  }
  await yarnInstall({ verbose })
}

// exported for testing
export async function runPreUpgradeScripts(ctx, task, { verbose, force }) {
  if (!ctx.versionToUpgradeTo) {
    return
  }

  const version = ctx.versionToUpgradeTo
  const parsed = semver.parse(version)
  const baseUrl =
    'https://raw.githubusercontent.com/cedarjs/cedar/main/upgrade-scripts/'
  const manifestUrl = `${baseUrl}manifest.json`

  let manifest = []
  try {
    const res = await fetch(manifestUrl)

    if (res.status === 200) {
      manifest = await res.json()
    } else {
      if (verbose) {
        console.log('No upgrade script manifest found.')
      }
    }
  } catch (e) {
    if (verbose) {
      console.log('Failed to fetch upgrade script manifest', e)
    }
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    return
  }

  const checkLevels = []
  if (parsed && !parsed.prerelease.length) {
    // 1. Exact match: 3.4.1
    checkLevels.push({
      id: 'exact',
      candidates: [`${version}.ts`, `${version}/index.ts`],
    })

    // 2. Patch wildcard: 3.4.x
    checkLevels.push({
      id: 'patch',
      candidates: [
        `${parsed.major}.${parsed.minor}.x.ts`,
        `${parsed.major}.${parsed.minor}.x/index.ts`,
      ],
    })

    // 3. Minor wildcard: 3.x
    checkLevels.push({
      id: 'minor',
      candidates: [`${parsed.major}.x.ts`, `${parsed.major}.x/index.ts`],
    })
  } else if (parsed && parsed.prerelease.length > 0) {
    // `parsed.prerelease[0]` is the prerelease tag, e.g. 'canary'
    checkLevels.push({
      id: 'tag',
      candidates: [
        `${parsed.prerelease[0]}.ts`,
        `${parsed.prerelease[0]}/index.ts`,
      ],
    })
  }

  const scriptsToRun = []

  // Find all existing scripts (one per level) using the manifest
  for (const level of checkLevels) {
    // Check both <version>.ts and <version>/index.ts
    for (const candidate of level.candidates) {
      if (manifest.includes(candidate)) {
        scriptsToRun.push(candidate)

        // Found a script for this level, move to next level
        break
      }
    }
  }

  if (scriptsToRun.length === 0) {
    if (verbose) {
      console.log(`No upgrade scripts found for ${version}`)
    }

    return
  }

  ctx.preUpgradeMessage = ''
  ctx.preUpgradeError = ''

  // Run them sequentially
  for (const scriptName of scriptsToRun) {
    task.output = `Found upgrade check script: ${scriptName}. Downloading...`

    const tempDir = await fs.promises.mkdtemp(
      // realpath: https://github.com/e18e/ecosystem-issues/issues/168
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-upgrade-'),
    )
    const scriptPath = path.join(tempDir, 'script.ts')

    // Check if this is a directory-based script (e.g., 3.4.1/index.ts)
    const isDirectoryScript = scriptName.includes('/')

    if (isDirectoryScript) {
      // Extract directory name (e.g., "3.4.1" from "3.4.1/index.ts")
      const dirName = scriptName.split('/')[0]
      const githubApiUrl = `https://api.github.com/repos/cedarjs/cedar/contents/upgrade-scripts/${dirName}`

      try {
        // Fetch directory contents from GitHub API
        const dirRes = await fetch(githubApiUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        })

        if (dirRes.status !== 200) {
          throw new Error(
            `Failed to fetch directory contents: ${dirRes.statusText}`,
          )
        }

        const files = await dirRes.json()

        // Download all files in the directory
        for (const file of files) {
          if (file.type === 'file') {
            task.output = `Downloading ${file.name}...`

            const fileRes = await fetch(file.download_url)

            if (fileRes.status !== 200) {
              throw new Error(`Failed to download ${file.name}`)
            }

            const fileContent = await fileRes.text()
            const filePath = path.join(tempDir, file.name)
            await fs.promises.writeFile(filePath, fileContent)

            // Rename index.ts to script.ts for execution
            if (file.name === 'index.ts') {
              await fs.promises.rename(filePath, scriptPath)
            }
          }
        }
      } catch (e) {
        if (verbose) {
          console.error(e)
        }
        throw new Error(
          `Failed to download upgrade script directory from ${githubApiUrl}`,
        )
      }
    } else {
      // Single file script - download directly
      const scriptUrl = `${baseUrl}${scriptName}`
      try {
        const res = await fetch(scriptUrl)

        if (res.status !== 200) {
          throw new Error(`Failed to download script: ${res.statusText}`)
        }

        const scriptContent = await res.text()
        await fs.promises.writeFile(scriptPath, scriptContent)
      } catch (e) {
        if (verbose) {
          console.error(e)
        }
        throw new Error(`Failed to download upgrade script from ${scriptUrl}`)
      }
    }

    // Read script content for dependency extraction
    const scriptContent = await fs.promises.readFile(scriptPath, 'utf8')
    const deps = extractDependencies(scriptContent)

    if (deps.length > 0) {
      const depList = deps.join(', ')
      task.output = `Installing dependencies for ${scriptName}: ${depList}...`

      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'pre-upgrade-script',
          version: '0.0.0',
          dependencies: {},
        }),
      )

      await execa('yarn', ['add', ...deps], { cwd: tempDir })
    }

    task.output = `Running pre-upgrade script: ${scriptName}...`
    let shouldCleanup = true
    try {
      const { stdout } = await execa(
        'node',
        ['script.ts', '--verbose', verbose, '--force', force],
        { cwd: tempDir },
      )

      if (stdout) {
        if (ctx.preUpgradeMessage) {
          ctx.preUpgradeMessage += '\n\n'
        }

        ctx.preUpgradeMessage += `\n${stdout}`
      }
    } catch (e) {
      const errorOutput = e.stdout || e.stderr || e.message || ''
      const errorMessage = `Pre-upgrade check ${scriptName} failed:\n${errorOutput}`

      if (ctx.preUpgradeError) {
        ctx.preUpgradeError += '\n\n'
      }

      ctx.preUpgradeError += errorMessage

      if (!force) {
        await fs.promises.rmdir(tempDir, { recursive: true })
        shouldCleanup = false

        // Return to skip remaining pre-upgrade scripts
        return
      }
    } finally {
      if (shouldCleanup) {
        await fs.promises.rmdir(tempDir, { recursive: true })
      }
    }
  }
}

const extractDependencies = (content) => {
  const deps = new Map()

  // 1. Explicit dependencies via comments
  // Example: // @dependency: lodash@^4.0.0
  const commentRegex = /\/\/\s*@dependency:\s*(\S+)/g
  let match
  while ((match = commentRegex.exec(content)) !== null) {
    const spec = match[1]
    // Extract name from specifier (e.g., 'foo@1.0.0' -> 'foo', '@scope/pkg@2' -> '@scope/pkg')
    const nameMatch = spec.match(/^(@?[^@\s]+)(?:@.+)?$/)
    if (nameMatch) {
      deps.set(nameMatch[1], spec)
    }
  }

  // 2. Implicit dependencies via imports
  const importRegex = /(?:import|from)\s*\(?['"]([^'"]+)['"]\)?/g

  while ((match = importRegex.exec(content)) !== null) {
    let name = match[1]

    if (
      name.startsWith('.') ||
      name.startsWith('/') ||
      name.startsWith('node:') ||
      builtinModules.includes(name)
    ) {
      continue
    }

    const parts = name.split('/')

    if (name.startsWith('@') && parts.length >= 2) {
      name = parts.slice(0, 2).join('/')
    } else if (parts.length >= 1) {
      name = parts[0]
    }

    // Explicit comments take precedence
    if (!deps.has(name)) {
      deps.set(name, name)
    }
  }

  return Array.from(deps.values())
}
