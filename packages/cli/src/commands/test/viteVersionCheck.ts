import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface ResolvedVite {
  version: string
  dir: string
}

export interface ViteVersions {
  /** The Vite that Vitest imports at runtime */
  vitestVite?: ResolvedVite
  /** The Vite that the CedarJS Vite plugins are built against */
  frameworkVite?: ResolvedVite
}

/**
 * Resolves `<packageName>/package.json` the way Node would from `fromFile`,
 * returning the package's version and directory. Returns `undefined` when
 * the package can't be resolved from there.
 */
function resolvePackage(
  fromFile: string,
  packageName: string,
): ResolvedVite | undefined {
  try {
    const require = createRequire(fromFile)
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageJson: unknown = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf-8'),
    )

    if (
      typeof packageJson !== 'object' ||
      packageJson === null ||
      !('version' in packageJson) ||
      typeof packageJson.version !== 'string'
    ) {
      return undefined
    }

    return {
      version: packageJson.version,
      dir: path.dirname(packageJsonPath),
    }
  } catch {
    return undefined
  }
}

/**
 * Finds the Vite copy Vitest runs on and the Vite copy the framework's plugins
 * are built against.
 *
 * Vitest declares a wide `vite` dependency range, so a project that doesn't
 * pin `vite` can end up with a newer Vite nested under `node_modules/vitest`
 * while `@cedarjs/vite` resolves the version the framework ships with. Both
 * lookups start from the package that does the importing, which is what makes
 * the nested copy show up.
 */
export function resolveViteVersions({
  projectBase,
  webBase,
}: {
  projectBase: string
  webBase: string
}): ViteVersions {
  const vitest = resolvePackage(
    path.join(projectBase, 'package.json'),
    'vitest',
  )
  const vitestVite = vitest
    ? resolvePackage(path.join(vitest.dir, 'package.json'), 'vite')
    : undefined

  const cedarVite = resolvePackage(
    path.join(webBase, 'package.json'),
    '@cedarjs/vite',
  )
  const frameworkVite = cedarVite
    ? resolvePackage(path.join(cedarVite.dir, 'package.json'), 'vite')
    : undefined

  return { vitestVite, frameworkVite }
}

/**
 * Returns an error message when Vitest runs on a different Vite than the
 * framework, and `undefined` when the versions match or either side can't be
 * resolved.
 */
export function getViteVersionMismatchMessage({
  vitestVite,
  frameworkVite,
}: ViteVersions): string | undefined {
  if (!vitestVite || !frameworkVite) {
    return undefined
  }

  if (vitestVite.version === frameworkVite.version) {
    return undefined
  }

  return (
    `Vitest is using Vite ${vitestVite.version} from\n` +
    `  ${vitestVite.dir}\n` +
    `but CedarJS is built against Vite ${frameworkVite.version} from\n` +
    `  ${frameworkVite.dir}\n\n` +
    "The CedarJS Vite plugins only work with the Vite version they're built " +
    "against, so web tests can't run while Vitest uses a different copy. " +
    "This happens when the project doesn't pin `vite`, because Vitest " +
    'accepts a wide range of Vite versions and installs the newest one.\n\n' +
    `Please add an override/resolution that pins vite to ` +
    `${frameworkVite.version}, then reinstall your dependencies.`
  )
}

/**
 * Exits with an explanatory error when Vitest would run on a different Vite
 * than the one the CedarJS Vite plugins are built against. Called before
 * Vitest starts so the user sees the cause instead of parse errors in every
 * `.test.tsx` file.
 */
export function assertSingleViteVersion() {
  const cedarPaths = getPaths()

  const message = getViteVersionMismatchMessage(
    resolveViteVersions({
      projectBase: cedarPaths.base,
      webBase: cedarPaths.web.base,
    }),
  )

  if (message) {
    console.error(message)
    process.exit(1)
  }
}
