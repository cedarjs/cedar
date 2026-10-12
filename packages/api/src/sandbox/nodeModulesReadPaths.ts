import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const startDir = (from: string | URL) => {
  const file =
    from instanceof URL || from.startsWith('file:')
      ? fileURLToPath(from)
      : path.resolve(from)
  // A path that isn't an existing folder is taken to be a file, which
  // needn't exist (like createRequire())
  return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()
    ? file
    : path.dirname(file)
}

const realpathOrNull = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/**
 * The real paths of the packages in `nodeModules` (and in its `@scope`
 * folders) that are symlinks to a folder outside it: workspace packages,
 * `yarn link`ed or `file:` packages. Not one that holds `from`: that's the
 * app's own workspace (its `api` side), with its source and maybe a
 * database file, which a workspace manager links too.
 */
const symlinkedPackagesOutside = (
  nodeModules: string,
  from: string,
): string[] => {
  const found: string[] = []

  const visit = (dir: string, scoped: boolean) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (!scoped && entry.name.startsWith('@') && entry.isDirectory()) {
        visit(entryPath, true)
      } else if (entry.isSymbolicLink()) {
        const target = realpathOrNull(entryPath)
        const inside = (dir: string) =>
          !!target && (dir === target || dir.startsWith(target + path.sep))
        if (
          target &&
          !target.startsWith(nodeModules + path.sep) &&
          !inside(from)
        ) {
          found.push(target)
        }
      }
    }
  }

  visit(nodeModules, false)
  return found
}

/**
 * The folders a sandboxed child may read so it can import packages: every
 * `node_modules` folder in `from` and in each folder above it, which is
 * where Node looks for a bare import, plus the folder of every package in
 * them that's a symlink to somewhere outside (a workspace package, a
 * linked one), except the workspace `from` is in. A `node_modules` that is a symlink is there under both
 * its paths, since Node reads through both; pnpm's symlinks point inside
 * `node_modules` and are covered by it.
 *
 * Only `node_modules` folders, never the folders that hold them: an app's
 * root, with its `.env`, stays unreadable.
 *
 * Yarn Plug'n'Play is not supported; Cedar apps use the `node-modules`
 * linker.
 */
export const nodeModulesReadPaths = (from: string | URL): string[] => {
  const found = new Set<string>()
  const start = startDir(from)
  const realFrom = realpathOrNull(start) ?? start

  // From `from` as given and from its real path: a child resolves its
  // imports from its real location, and `from` may be under a symlink
  // (`current -> releases/…`) with node_modules above either
  for (let dir of new Set([start, realFrom])) {
    for (;;) {
      const nodeModules = path.join(dir, 'node_modules')
      const real = realpathOrNull(nodeModules)
      if (real && fs.statSync(real).isDirectory()) {
        // Node reads a package's package.json through the path it looked
        // in, and its modules through their real paths, so a node_modules
        // that is itself a symlink needs both
        found.add(nodeModules)
        found.add(real)
        for (const target of symlinkedPackagesOutside(real, realFrom)) {
          found.add(target)
        }
      }

      const parent = path.dirname(dir)
      if (parent === dir) {
        break
      }
      dir = parent
    }
  }

  return [...found]
}
