import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SandboxReadPathsOptions {
  /**
   * Where to resolve the packages from, as Node would for an `import` in
   * that file: a file path, a directory, or a `file:` URL. Usually
   * `import.meta.url`.
   */
  from: string | URL
  /**
   * Whether to include the folders of each package's dependencies, all the
   * way down: its `dependencies`, and those of its `optionalDependencies`
   * and `peerDependencies` that are installed. Default true.
   */
  dependencies?: boolean
}

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const startDir = (from: string | URL) => {
  const file =
    from instanceof URL || from.startsWith('file:')
      ? fileURLToPath(from)
      : path.resolve(from)
  // Like createRequire(), a path that isn't an existing folder is taken to
  // be a file, which needn't exist
  return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()
    ? file
    : path.dirname(file)
}

/**
 * The installed folder of package `name`, looked up from `dir` the way
 * Node looks up a bare import: in `node_modules` next to `dir`, then in
 * each folder above it. Reads no `exports` map, so it also finds packages
 * that don't export their `package.json`.
 */
const findPackageDir = (name: string, dir: string): string | null => {
  let current = dir
  for (;;) {
    const candidate = path.join(current, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const readPackageJson = (dir: string): PackageJson => {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  )
  return parsed && typeof parsed === 'object' ? parsed : {}
}

/**
 * The folders a sandboxed child needs read access to in order to import
 * `packages`: each package's installed folder and, by default, the folders
 * of everything it depends on — including the platform-specific optional
 * packages that native libraries ship their binaries in (sharp's
 * `@img/sharp-<platform>` and `@img/sharp-libvips-<platform>`, for
 * example). Pass the result as `readable` to `runSandboxedChild()`.
 *
 * Packages are found the way Node finds a bare import from `from`
 * (`node_modules` folders, walking up), and dependencies the way each
 * package would find its own. Optional and peer dependencies that aren't
 * installed are skipped; a missing regular dependency throws, as importing
 * it in the child would fail anyway. Yarn Plug'n'Play is not supported.
 *
 * Returned paths are real paths, de-duplicated.
 *
 * @example
 * ```ts
 * const readable = sandboxReadPaths(['sharp'], { from: import.meta.url })
 * // [ '…/node_modules/sharp', '…/node_modules/@img/colour',
 * //   '…/node_modules/detect-libc', '…/node_modules/semver',
 * //   '…/node_modules/@img/sharp-darwin-arm64',
 * //   '…/node_modules/@img/sharp-libvips-darwin-arm64' ]
 * ```
 */
export const sandboxReadPaths = (
  packages: string[],
  { from, dependencies = true }: SandboxReadPathsOptions,
): string[] => {
  const root = startDir(from)
  const found: string[] = []
  const seen = new Set<string>()

  const visit = (
    name: string,
    lookupDir: string,
    required: boolean,
    dependent: string,
  ) => {
    const dir = findPackageDir(name, lookupDir)
    if (!dir) {
      if (required) {
        throw new Error(
          `sandboxReadPaths: can't find package "${name}" (needed by ` +
            `${dependent}) in any node_modules folder from ${lookupDir}`,
        )
      }
      return
    }
    if (seen.has(dir)) {
      return
    }
    seen.add(dir)
    found.push(dir)

    if (!dependencies) {
      return
    }
    const pkg = readPackageJson(dir)
    const optional = new Set([
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ])
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      visit(dep, dir, !optional.has(dep), name)
    }
    for (const dep of optional) {
      visit(dep, dir, false, name)
    }
  }

  for (const name of packages) {
    visit(name, root, true, root)
  }
  return found
}
