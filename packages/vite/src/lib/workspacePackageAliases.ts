import fs from 'node:fs'
import path from 'node:path'

import type { Config, Paths } from '@cedarjs/project-config'

/**
 * Given a workspace package directory and its parsed package.json, attempts to
 * locate the TypeScript source entry file that corresponds to the package's
 * declared dist entry.
 *
 * Strategy: read `main` (or the default `exports` entry) from package.json,
 * derive the probable source path by substituting `dist/` → `src/` and
 * trying common TypeScript/JavaScript extensions in order.
 *
 * Returns the absolute path to the source file, or null if none is found.
 */
function findSourceEntry(
  pkgDir: string,
  pkgJson: { main?: string; exports?: unknown },
): string | null {
  // Prefer `main`; fall back to the default export condition
  let distEntry: string | null = null

  if (typeof pkgJson.main === 'string') {
    distEntry = pkgJson.main
  } else if (pkgJson.exports) {
    const root = (pkgJson.exports as Record<string, unknown>)['.']

    if (typeof root === 'string') {
      distEntry = root
    } else if (root && typeof root === 'object') {
      const rootObj = root as Record<string, unknown>

      if (typeof rootObj['default'] === 'string') {
        distEntry = rootObj['default']
      }
    }
  }

  if (!distEntry) {
    return null
  }

  // Normalise: strip leading "./" and remove JS extension
  // e.g. "./dist/index.js" → "dist/index"
  const withoutLeadingDot = distEntry.replace(/^\.\//, '')
  const withoutExt = withoutLeadingDot.replace(/\.(js|cjs|mjs)$/, '')

  // Map dist/ → src/
  const srcBase = withoutExt.replace(/^dist\//, 'src/')

  // Try TypeScript extensions first, then JavaScript
  for (const ext of ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']) {
    const candidate = path.join(pkgDir, srcBase + ext)

    if (fs.existsSync(candidate)) {
      // Normalise to forward slashes so Vite's alias plugin resolves the path
      // correctly on Windows (Vite uses forward slashes for all module ids).
      return candidate.replaceAll('\\', '/')
    }
  }

  return null
}

/**
 * Mirrors the logic used in buildHandler.ts / buildPackagesTask.js:
 * - Only runs when `experimental.packagesWorkspace.enabled` is true
 * - Reads the root package.json workspaces array to find non-api/web entries
 * - Enumerates the packages/ directory to get each package's name and
 *   inferred TypeScript source entry
 *
 * Returns a map of package name → absolute source file path suitable for use
 * as Vite `resolve.alias` entries. This allows the Vite dev server to resolve
 * workspace package imports directly to their TypeScript source without
 * requiring a prior build step (i.e. without needing `dist/` to exist).
 *
 * This is intentionally synchronous so it can be used in contexts such as
 * `getMergedConfig` which are called synchronously by Vite.
 */
export function getWorkspacePackageAliases(
  cedarPaths: Paths,
  cedarConfig: Config,
): Record<string, string> {
  if (!cedarConfig.experimental?.packagesWorkspace?.enabled) {
    return {}
  }

  if (!cedarPaths.packages || !fs.existsSync(cedarPaths.packages)) {
    return {}
  }

  try {
    const rootPkgPath = path.join(cedarPaths.base, 'package.json')
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8')) as {
      workspaces?: unknown
    }

    if (!Array.isArray(rootPkg.workspaces) || rootPkg.workspaces.length <= 2) {
      return {}
    }

    // Find workspaces that are not 'api' or 'web' (i.e. packages/* entries),
    // mirroring the nonApiWebWorkspaces check in buildHandler.ts
    const nonApiWebWorkspaces = (rootPkg.workspaces as string[]).filter(
      (w) => w !== 'api' && w !== 'web',
    )

    if (nonApiWebWorkspaces.length === 0) {
      return {}
    }

    const entries = fs.readdirSync(cedarPaths.packages, { withFileTypes: true })
    const aliases: Record<string, string> = {}

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const pkgDir = path.join(cedarPaths.packages, entry.name)
      const pkgJsonPath = path.join(pkgDir, 'package.json')

      if (!fs.existsSync(pkgJsonPath)) {
        continue
      }

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
        name?: string
        main?: string
        exports?: unknown
      }

      if (!pkgJson.name) {
        continue
      }

      const sourceEntry = findSourceEntry(pkgDir, pkgJson)

      if (sourceEntry) {
        aliases[pkgJson.name] = sourceEntry
      }
    }

    return aliases
  } catch {
    return {}
  }
}
