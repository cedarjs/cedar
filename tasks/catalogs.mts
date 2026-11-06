/**
 * Reads the Yarn catalogs (`catalog` and `catalogs` in `.yarnrc.yml`) and
 * resolves `catalog:` ranges to the versions they stand for.
 *
 * Workspace `package.json` files refer to shared versions with `catalog:`
 * (the default catalog) or `catalog:<name>` (a named catalog). Yarn resolves
 * those itself on install and on `yarn pack`. Anything else that reads a
 * workspace's dependency ranges from source has to resolve them with
 * `resolveCatalogRange()`.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

const CATALOG_PROTOCOL = 'catalog:'

type Catalog = Record<string, string>

export interface Catalogs {
  catalog: Catalog
  catalogs: Record<string, Catalog>
}

const cache = new Map<string, Catalogs>()

function readYarnConfig(cwd: string, key: string): unknown {
  // Yarn parses `.yarnrc.yml` itself, so these are exactly the catalogs it
  // installs from
  const output = execFileSync('yarn', ['config', 'get', key, '--json'], {
    cwd,
    encoding: 'utf-8',
    // Yarn is a shell script on Windows
    shell: process.platform === 'win32',
  })

  return JSON.parse(output)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The default and named catalogs of the Yarn project in `cwd` (the Cedar
 * framework repo by default).
 */
export function getCatalogs(
  cwd: string = path.join(import.meta.dirname, '..'),
): Catalogs {
  const cached = cache.get(cwd)

  if (cached) {
    return cached
  }

  const catalog = readYarnConfig(cwd, 'catalog')
  const catalogs = readYarnConfig(cwd, 'catalogs')

  if (!isRecord(catalog) || !isRecord(catalogs)) {
    throw new Error(`Could not read the Yarn catalogs in ${cwd}`)
  }

  const result: Catalogs = {
    // `yarn config get` prints every catalog entry as a string
    catalog: catalog as Catalog,
    catalogs: catalogs as Record<string, Catalog>,
  }

  cache.set(cwd, result)

  return result
}

export function isCatalogRange(range: string): boolean {
  return range.startsWith(CATALOG_PROTOCOL)
}

/**
 * Turns `catalog:` and `catalog:<name>` into the version that catalog has
 * for `packageName`. Any other range is returned as it is.
 */
export function resolveCatalogRange(
  packageName: string,
  range: string,
  catalogs: Catalogs = getCatalogs(),
): string {
  if (!isCatalogRange(range)) {
    return range
  }

  const catalogName = range.slice(CATALOG_PROTOCOL.length)
  const catalog = catalogName
    ? catalogs.catalogs[catalogName]
    : catalogs.catalog
  const version = catalog?.[packageName]

  if (!version) {
    const catalogLabel = catalogName
      ? `the "${catalogName}" catalog`
      : 'the default catalog'

    throw new Error(
      `${packageName} uses ${range}, but ${catalogLabel} in .yarnrc.yml ` +
        `has no ${packageName} entry`,
    )
  }

  return version
}
