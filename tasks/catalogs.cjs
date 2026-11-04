// @ts-check

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

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const CATALOG_PROTOCOL = 'catalog:'

/**
 * @typedef {Record<string, string>} Catalog
 * @typedef {{ catalog: Catalog, catalogs: Record<string, Catalog> }} Catalogs
 */

/** @type {Map<string, Catalogs>} */
const cache = new Map()

/**
 * @param {string} cwd
 * @param {string} key
 * @returns {unknown}
 */
function readYarnConfig(cwd, key) {
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

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The default and named catalogs of the Yarn project in `cwd` (the Cedar
 * framework repo by default).
 *
 * @param {string} [cwd]
 * @returns {Catalogs}
 */
function getCatalogs(cwd = path.join(__dirname, '..')) {
  const cached = cache.get(cwd)

  if (cached) {
    return cached
  }

  const catalog = readYarnConfig(cwd, 'catalog')
  const catalogs = readYarnConfig(cwd, 'catalogs')

  if (!isRecord(catalog) || !isRecord(catalogs)) {
    throw new Error(`Could not read the Yarn catalogs in ${cwd}`)
  }

  /** @type {Catalogs} */
  const result = {
    // `yarn config get` prints every catalog entry as a string
    catalog: /** @type {Catalog} */ (catalog),
    catalogs: /** @type {Record<string, Catalog>} */ (catalogs),
  }

  cache.set(cwd, result)

  return result
}

/**
 * @param {string} range
 */
function isCatalogRange(range) {
  return range.startsWith(CATALOG_PROTOCOL)
}

/**
 * Turns `catalog:` and `catalog:<name>` into the version that catalog has
 * for `packageName`. Any other range is returned as it is.
 *
 * @param {string} packageName
 * @param {string} range
 * @param {Catalogs} [catalogs]
 * @returns {string}
 */
function resolveCatalogRange(packageName, range, catalogs = getCatalogs()) {
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

module.exports = { getCatalogs, isCatalogRange, resolveCatalogRange }
