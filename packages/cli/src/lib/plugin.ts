import fs from 'node:fs'
import path from 'path'

import ansis from 'ansis'
import enquirer from 'enquirer'

import { getCompatibilityData } from '@cedarjs/cli-helpers'

import { installModule, isModuleInstalled } from './packages.js'

import { getPaths } from './index.js'

// enquirer's type declarations (the .d.ts file) don't include a declaration for
// Select. The type file only declares Enquirer.prompt() and Enquirer.Prompt,
// but the actual enquirer module also exports Select, Input, MultiSelect, etc.
// at runtime.
// There's an open issue about adding better ESM support, and a PR for better
// types
// https://github.com/enquirer/enquirer/issues/439
// https://github.com/enquirer/enquirer/pull/307
const { Select } = enquirer as unknown as {
  Select: new (options: {
    name: string
    message: string
    choices: { name: string; message: string }[]
  }) => { run(): Promise<string> }
}

export type CacheEntry = Record<
  string,
  { aliases?: string[]; description?: string }
>

export interface PluginCommandCache {
  _builtin: string[]
  [packageName: string]: CacheEntry | string[]
}

/**
 * The file inside .cedar which will contain cached plugin command mappings
 */
export const PLUGIN_CACHE_FILENAME = 'commandCache.json'

/**
 * A cache of yargs information for redwood commands that are available from
 * plugins.
 *
 * This is intended to be used for commands which lazy install their
 * dependencies so that this information otherwise would not be available and
 * help output would be unavailable/incorrect.
 */
export const PLUGIN_CACHE_DEFAULT: Record<string, CacheEntry> = {
  '@cedarjs/cli-storybook-vite': {
    storybook: {
      aliases: ['sb'],
      description:
        'Launch Storybook: a tool for building UI components and pages in isolation',
    },
  },
  '@cedarjs/cli-data-migrate': {
    'data-migrate <command>': {
      aliases: ['dataMigrate', 'dm'],
      description: 'Migrate the data in your database',
    },
  },
}

/**
 * A list of commands that are built into the CLI and require no plugin to be
 * loaded.
 */
export const PLUGIN_CACHE_BUILTIN = [
  'build',
  'check',
  'diagnostics',
  'console',
  'c',
  'deploy',
  'destroy',
  'd',
  'dev',
  'exec',
  'experimental',
  'exp',
  'generate',
  'g',
  'info',
  'lint',
  'prerender',
  'render',
  'prisma',
  'record',
  'serve',
  'setup',
  'test',
  'ts-to-js',
  'type-check',
  'tsc',
  'tc',
  'upgrade',
] satisfies string[]

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

export function loadCommandCache(): PluginCommandCache {
  // Always default to the default cache
  let pluginCommandCache: Record<string, unknown> = { ...PLUGIN_CACHE_DEFAULT }
  const commandCachePath = path.join(
    getPaths().generated.base,
    PLUGIN_CACHE_FILENAME,
  )
  try {
    const localCommandCache = JSON.parse(
      fs.readFileSync(commandCachePath, 'utf8'),
    )
    // This validity check is rather naive but it exists to invalidate a
    // previous format of the cache file
    let valid = true
    for (const [key, value] of Object.entries(
      localCommandCache as Record<string, unknown>,
    )) {
      if (key === '_builtin') {
        continue
      }
      valid &&= !Array.isArray(value)
    }
    if (valid) {
      // Merge the default cache with the local cache but ensure the default
      // cache takes precedence - this ensure the cache is consistent with the
      // current version of the framework
      pluginCommandCache = {
        ...(localCommandCache as Record<string, unknown>),
        ...PLUGIN_CACHE_DEFAULT,
      }
    }
  } catch (error: unknown) {
    // If the cache file doesn't exist we can just ignore it and continue
    if (!isErrorWithCode(error, 'ENOENT')) {
      console.error(`Error loading plugin command cache at ${commandCachePath}`)
      console.error(error)
    }
  }
  // Built in commands must be in sync with the framework code
  pluginCommandCache._builtin = PLUGIN_CACHE_BUILTIN
  return pluginCommandCache as PluginCommandCache
}

export function saveCommandCache(pluginCommandCache: PluginCommandCache): void {
  const commandCachePath = path.join(
    getPaths().generated.base,
    PLUGIN_CACHE_FILENAME,
  )
  try {
    fs.writeFileSync(
      commandCachePath,
      JSON.stringify(pluginCommandCache, undefined, 2),
    )
  } catch (error: unknown) {
    console.error(`Error saving plugin command cache at ${commandCachePath}`)
    console.error(error)
  }
}

/**
 * Logs warnings for any plugins that have invalid definitions in cedar.toml
 */
export function checkPluginListAndWarn(
  plugins: { package?: string; enabled?: boolean }[],
): void {
  // Plugins must define a package
  for (const plugin of plugins) {
    if (!plugin.package) {
      console.warn(
        ansis.yellow(`⚠️  A plugin is missing a package, it cannot be loaded.`),
      )
    }
  }

  // Plugins should only occur once in the list
  const pluginPackages = plugins
    .map((p) => p.package)
    .filter((p): p is string => p !== undefined)
  if (pluginPackages.length !== new Set(pluginPackages).size) {
    console.warn(
      ansis.yellow(
        '⚠️  Duplicate plugin packages found in your cedar.toml, duplicates ' +
          'will be ignored.',
      ),
    )
  }

  // Plugins should be published to npm under a scope which is used as the
  // namespace
  const namespaces = plugins.map((p) => p.package?.split('/')[0])
  namespaces.forEach((ns) => {
    if (ns !== undefined && !ns.startsWith('@')) {
      console.warn(
        ansis.yellow(
          `⚠️  Plugin "${ns}" is missing a scope/namespace, it will not be ` +
            'loaded.',
        ),
      )
    }
  })
}

/**
 * Attempts to load a plugin package and return it. Returns null if the plugin
 * failed to load.
 *
 * @param packageName The npm package name of the plugin
 * @param packageVersion The npm package version of the plugin, defaults to
 * loading the plugin at the same version as the cli
 * @param autoInstall Whether to automatically install the plugin package if it
 * is not installed already
 */
export async function loadPluginPackage(
  packageName: string,
  packageVersion: string | undefined,
  autoInstall: boolean,
): Promise<Record<string, unknown> | null> {
  // NOTE: This likely does not handle mismatch versions between what is
  // installed and what is requested
  if (isModuleInstalled(packageName)) {
    return await import(packageName)
  }

  if (!autoInstall) {
    console.warn(
      ansis.yellow(
        `⚠️  Plugin "${packageName}" cannot be loaded because it is not ` +
          'installed and "autoInstall" is disabled.',
      ),
    )

    return null
  }

  // Attempt to install the plugin
  console.log(ansis.green(`Installing plugin "${packageName}"...`))
  const installed = await installPluginPackage(packageName, packageVersion)
  if (installed) {
    return await import(packageName)
  }
  return null
}

/**
 * Attempts to install a plugin package. Installs the package as a dev
 * dependency.
 *
 * @param packageName The npm package name of the plugin
 * @param packageVersion The npm package version of the plugin to install or
 * undefined to install the same version as the cli
 * @returns True if the plugin was installed successfully, false otherwise
 */
async function installPluginPackage(
  packageName: string,
  packageVersion: string | undefined,
): Promise<boolean> {
  // We use a simple heuristic here to try and be a little more convenient for
  // the user when no version is specified.

  let versionToInstall = packageVersion
  const isRedwoodPackage = packageName.startsWith('@cedarjs/')
  if (!isRedwoodPackage && versionToInstall === undefined) {
    versionToInstall = 'latest'
    try {
      const compatibilityData = await getCompatibilityData(
        packageName,
        versionToInstall,
      )
      versionToInstall = compatibilityData.compatible.version
      console.log(
        ansis.green(
          `Installing the latest compatible version: ${versionToInstall}`,
        ),
      )
    } catch (error: unknown) {
      console.log(
        'The following error occurred while checking plugin compatibility for automatic installation:',
      )
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.log(errorMessage)

      // Exit without a chance to continue if it makes sense to do so
      if (
        errorMessage.includes('does not have a tag') ||
        errorMessage.includes('does not have a version')
      ) {
        process.exit(1)
      }

      const prompt = new Select({
        name: 'versionDecision',
        message: 'What would you like to do?',
        choices: [
          {
            name: 'cancel',
            message: 'Cancel',
          },
          {
            name: 'continue',
            message: "Continue and install the 'latest' version",
          },
        ],
      })
      const decision = await prompt.run()
      if (decision === 'cancel') {
        process.exit(1)
      }
    }
  }

  try {
    // Note that installModule does the cli version matching for us if
    // versionToInstall is undefined
    await installModule(packageName, versionToInstall)
    return true
  } catch (error) {
    console.error(error)

    return false
  }
}
