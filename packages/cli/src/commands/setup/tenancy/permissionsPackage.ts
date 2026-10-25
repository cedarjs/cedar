import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'
import * as toml from 'smol-toml'

import { runScript } from '@cedarjs/cli-helpers/packageManager/exec'
import { installPackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { addWorkspaceDir } from '@cedarjs/cli-helpers/packageManager/workspaces'
import { getConfigPath } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { getPaths, writeFile } from '../../../lib/index.js'
import {
  addDependencyToPackageJson,
  nameVariants,
  updateGitignore,
  updateTsconfig,
  updateWorkspaceTsconfigReferences,
} from '../../generate/package/packageHandler.js'

export const PERMISSIONS_PACKAGE_FOLDER = 'permissions'

const TABLE_HEADER = '[experimental.packagesWorkspace]'

/**
 * `cedar.toml`'s content with the experimental packages workspace turned
 * on, which the permissions package needs, or `null` when it already is.
 */
export function enablePackagesWorkspace(tomlContent: string): string | null {
  const config = toml.parse(tomlContent) as {
    experimental?: { packagesWorkspace?: { enabled?: unknown } }
  }
  const packagesWorkspace = config.experimental?.packagesWorkspace

  if (packagesWorkspace?.enabled === true) {
    return null
  }

  const lines = tomlContent.split('\n')
  const headerIndex = lines.findIndex((line) => line.trim() === TABLE_HEADER)

  if (headerIndex === -1) {
    if (packagesWorkspace) {
      // Set some other way (dotted keys, an inline table), which we'd only
      // risk breaking
      throw new Error(
        'CEDAR_TENANCY_ERR_PACKAGES_WORKSPACE: set ' +
          '`experimental.packagesWorkspace.enabled = true` in cedar.toml ' +
          'and run this command again.',
      )
    }

    return (
      tomlContent.replace(/\n*$/, '') +
      `\n\n${TABLE_HEADER}\n  enabled = true\n`
    )
  }

  const tableEnd = lines.findIndex(
    (line, index) => index > headerIndex && /^\s*\[/.test(line),
  )
  const end = tableEnd === -1 ? lines.length : tableEnd
  const enabledIndex = lines.findIndex(
    (line, index) =>
      index > headerIndex && index < end && /^\s*enabled\s*=/.test(line),
  )

  if (enabledIndex === -1) {
    lines.splice(headerIndex + 1, 0, '  enabled = true')
  } else {
    lines[enabledIndex] = lines[enabledIndex].replace(
      /enabled\s*=.*/,
      'enabled = true',
    )
  }

  return lines.join('\n')
}

/** The permissions package's name, e.g. `@my-app/permissions` */
export function permissionsPackageName() {
  return nameVariants(PERMISSIONS_PACKAGE_FOLDER).packageName
}

/**
 * The files of the shared permissions package, keyed by their path from
 * the package's folder
 */
export function permissionsPackageFiles({
  packageName,
  cedarVersion,
  indexSource,
}: {
  packageName: string
  cedarVersion: string
  indexSource: string
}): Record<string, string> {
  const packageJson = {
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: 'dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
    scripts: {
      build: 'tsc',
      watch: 'tsc --watch',
    },
    dependencies: {
      '@cedarjs/tenancy': cedarVersion,
    },
    devDependencies: {
      typescript: '5.9.3',
    },
  }

  const tsconfig = {
    compilerOptions: {
      composite: true,
      target: 'es2023',
      module: 'node20',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      rootDir: 'src',
      outDir: 'dist',
      sourceMap: true,
      declaration: true,
      declarationMap: true,
    },
    include: ['src'],
  }

  return {
    'package.json': JSON.stringify(packageJson, null, 2) + '\n',
    'tsconfig.json': JSON.stringify(tsconfig, null, 2) + '\n',
    'src/index.ts': indexSource,
  }
}

/**
 * Adds `packages/permissions`, the app's permission definitions, which both
 * the api (to check them) and the web (for their names) import. It's a
 * package in the experimental packages workspace, which this turns on.
 */
export function addPermissionsPackageTasks({
  cedarVersion,
  indexSource,
  force,
}: {
  cedarVersion: string
  indexSource: string
  force: boolean
}) {
  const paths = getPaths()
  const packageDir = path.join(
    paths.base,
    'packages',
    PERMISSIONS_PACKAGE_FOLDER,
  )
  const packageName = permissionsPackageName()

  return new Listr([
    {
      title: 'Turning on the packages workspace in cedar.toml...',
      task: (_ctx, task) => {
        const configPath = getConfigPath()
        const updated = enablePackagesWorkspace(
          fs.readFileSync(configPath, 'utf-8'),
        )

        if (updated === null) {
          task.skip('Already on')
          return
        }

        fs.writeFileSync(configPath, updated)
      },
    },
    {
      title: 'Updating workspace config...',
      task: (_ctx, task) => {
        const result = addWorkspaceDir(
          paths.base,
          `packages/${PERMISSIONS_PACKAGE_FOLDER}`,
          getPackageManager(),
        )

        if (result === 'exists') {
          task.skip('Workspaces already configured')
        }
      },
    },
    {
      title: 'Updating tsconfig files...',
      task: (_ctx, task) => updateTsconfig(task),
    },
    {
      title: 'Updating .gitignore...',
      task: (_ctx, task) => updateGitignore(task),
    },
    {
      title: `Writing ${packageName}...`,
      task: () => {
        const files = permissionsPackageFiles({
          packageName,
          cedarVersion,
          indexSource,
        })

        for (const [file, content] of Object.entries(files)) {
          writeFile(path.join(packageDir, file), content, {
            overwriteExisting: force,
          })
        }
      },
    },
    {
      title: 'Adding it to the api and web sides...',
      task: async (_ctx, task) => {
        for (const side of [paths.api.base, paths.web.base]) {
          await addDependencyToPackageJson(
            task,
            path.join(side, 'package.json'),
            packageName,
          )
        }
      },
    },
    {
      title: 'Updating tsconfig references...',
      task: (_ctx, task) =>
        updateWorkspaceTsconfigReferences(
          task,
          PERMISSIONS_PACKAGE_FOLDER,
          'both',
        ),
    },
    {
      title: 'Installing and building it...',
      task: async () => {
        await installPackages({ cwd: paths.base })
        await runScript('build', [], { cwd: packageDir })
      },
    },
  ])
}
