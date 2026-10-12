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

interface NodeModulesContents {
  /** Every package's name: `name`, or `@scope/name` */
  names: string[]
  /**
   * Packages linked to folders outside node_modules that the child may
   * read: their real folders
   */
  linkedTargets: string[]
  /** Packages that are links to app workspaces the child may not read */
  excluded: string[]
}

/**
 * The packages in `nodeModules`, and which of them are symlinks to a folder
 * outside it: workspace packages, `yarn link`ed or `file:` packages. Of
 * those, the workspace that holds `from` (the app's `api` side, with its
 * source and maybe a database file, which a workspace manager links too)
 * and its siblings (`web`) are excluded; packages from other folders, like
 * `packages/*`, aren't.
 */
const readNodeModules = (
  nodeModules: string,
  from: string,
): NodeModulesContents => {
  const names: string[] = []
  const links: { name: string; target: string }[] = []

  const visit = (dir: string, scope: string | null) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (!scope && entry.name.startsWith('@') && entry.isDirectory()) {
        visit(entryPath, entry.name)
        continue
      }
      const name = scope ? `${scope}/${entry.name}` : entry.name
      names.push(name)
      if (entry.isSymbolicLink()) {
        const target = realpathOrNull(entryPath)
        if (target && !target.startsWith(nodeModules + path.sep)) {
          links.push({ name, target })
        }
      }
    }
  }

  visit(nodeModules, null)

  const own = links.find(
    ({ target }) => from === target || from.startsWith(target + path.sep),
  )
  const workspacesFolder = own && path.dirname(own.target)
  const isExcluded = ({ target }: { target: string }) =>
    target === own?.target || path.dirname(target) === workspacesFolder

  return {
    names,
    linkedTargets: links.filter((l) => !isExcluded(l)).map((l) => l.target),
    excluded: links.filter(isExcluded).map((l) => l.name),
  }
}

/**
 * The shortest prefixes that start every name in `names` and no name in
 * `excluded`, for `--allow-fs-read=<node_modules>/<prefix>*` grants. The
 * permission model follows a symlink in a granted folder wherever it
 * leads, so a node_modules with a link to a workspace the child may not
 * read is granted package by package, not as a whole; prefixes keep that a
 * few dozen arguments rather than one per package.
 */
const prefixesExcluding = (names: string[], excluded: string[]) => {
  const prefixes = new Set<string>()
  for (const name of names) {
    if (excluded.includes(name)) {
      continue
    }
    let length = 1
    while (
      excluded.some((e) => e.startsWith(name.slice(0, length))) &&
      length <= name.length
    ) {
      length += 1
    }
    // A name that starts an excluded one (`web` for `web-app`) needs an
    // exact grant for itself and a trailing separator for its contents
    prefixes.add(length > name.length ? `${name}/` : name.slice(0, length))
  }
  return [...prefixes]
}

/**
 * The folders a sandboxed child may read so it can import packages: every
 * `node_modules` folder in `from` and in each folder above it, which is
 * where Node looks for a bare import, plus the folder of every package in
 * them that's a symlink to somewhere outside (a workspace package, a
 * linked one), except the workspace `from` is in and its siblings, whose
 * links in node_modules aren't readable either. A `node_modules` that is a
 * symlink is there under both
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
        const { names, linkedTargets, excluded } = readNodeModules(
          real,
          realFrom,
        )
        for (const folder of new Set([nodeModules, real])) {
          if (excluded.length === 0) {
            found.add(folder)
          } else {
            for (const prefix of prefixesExcluding(names, excluded)) {
              // Not path.join(), which would turn a `.` prefix (for
              // `.pnpm`) into the folder itself
              found.add(
                `${folder}${path.sep}${prefix.split('/').join(path.sep)}*`,
              )
            }
          }
        }
        for (const target of linkedTargets) {
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
