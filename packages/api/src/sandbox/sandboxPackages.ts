import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Package `name` as Node finds it for an import in `fromFile`: in the
 * `node_modules` folders Node looks in, in order. It reads the package's
 * `package.json` from disk, so it works whatever the package's `exports`
 * allow (sharp 0.35 doesn't export its `package.json`; some packages have
 * only an `import` condition). Returns the path Node finds it at and its
 * real folder, which differ when it's a symlink (pnpm, workspaces).
 */
const findPackage = (name: string, fromFile: string) => {
  for (const dir of createRequire(fromFile).resolve.paths(name) ?? []) {
    const found = path.join(dir, name)
    if (!fs.existsSync(path.join(found, 'package.json'))) {
      continue
    }
    const realDir = fs.realpathSync(found)
    const pkg: PackageJson = JSON.parse(
      fs.readFileSync(path.join(realDir, 'package.json'), 'utf8'),
    )
    if (pkg.name === name) {
      return { found, realDir, pkg }
    }
  }
  return null
}

/**
 * The folders a sandboxed child needs to read to import `packages` from
 * `fromFile` (its script): each package's folder and, recursively, those
 * of its `dependencies` and installed `optionalDependencies` and
 * `peerDependencies`, each resolved from the folder of the package that
 * needs it, as Node will at run time. That covers nested versions, pnpm's
 * layout and native packages' platform binaries (`@img/sharp-<platform>`)
 * without naming a platform. Optional and peer dependencies that aren't
 * installed are skipped; a missing package or regular dependency throws.
 *
 * A package reached through a symlink is granted at both paths: Node reads
 * its `package.json` through the path it looked in, and its modules
 * through their real paths.
 */
export const sandboxPackagePaths = (packages: string[], fromFile: string) => {
  const paths = new Set<string>()
  const visited = new Set<string>()

  const visit = (name: string, from: string, required: boolean, by: string) => {
    const found = findPackage(name, from)
    if (!found) {
      if (required) {
        throw new Error(
          `Can't find package "${name}" (needed by ${by}) in any ` +
            `node_modules folder Node looks in from ${path.dirname(from)}`,
        )
      }
      return
    }
    paths.add(found.found).add(found.realDir)
    if (visited.has(found.realDir)) {
      return
    }
    visited.add(found.realDir)

    const manifest = path.join(found.realDir, 'package.json')
    const { dependencies = {}, optionalDependencies = {} } = found.pkg
    const optional = { ...optionalDependencies, ...found.pkg.peerDependencies }
    for (const dep of Object.keys(dependencies)) {
      visit(dep, manifest, !(dep in optional), name)
    }
    for (const dep of Object.keys(optional)) {
      visit(dep, manifest, false, name)
    }
  }

  for (const name of packages) {
    visit(name, fromFile, true, path.basename(fromFile))
  }
  return [...paths]
}
