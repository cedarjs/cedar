import fs from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

import fg from 'fast-glob'

/**
 * The folder in `api/dist/ud` a bundled API build puts every sandboxed
 * child script in, as `<name>.child.js`, with a `node_modules` holding the
 * packages they import. `findChildScript()` in `@cedarjs/api/sandbox`
 * looks for `api/dist/ud/sandbox-children` from its caller's folder up.
 */
export const SANDBOX_CHILDREN_DIR = 'sandbox-children'

/**
 * Every sandboxed child script in `apiSrc` (`**\/*.child.{ts,js,mts,mjs}`),
 * as `{ 'sandbox-children/<name>.child': file }`, for a bundled build's
 * `input`. Throws when two have the same name: in a bundle they all go in
 * one folder, and `findChildScript()` finds them by name.
 */
export function findSandboxChildScripts(
  apiSrc: string,
): Record<string, string> {
  const files = fg
    .sync('**/*.child.{ts,js,mts,mjs}', {
      cwd: apiSrc,
      absolute: true,
      ignore: ['**/node_modules/**', '**/__tests__/**'],
    })
    .sort()

  const entries: Record<string, string> = {}
  for (const file of files) {
    const name = path.basename(file).replace(/\.(ts|js|mts|mjs)$/, '')
    const key = `${SANDBOX_CHILDREN_DIR}/${name}`
    if (entries[key]) {
      throw new Error(
        `Two sandboxed child scripts are named ${name}: ` +
          `${path.relative(apiSrc, entries[key])} and ` +
          `${path.relative(apiSrc, file)}. A bundled build puts every ` +
          `child script in one folder, so their names must be unique.`,
      )
    }
    entries[key] = path.normalize(file)
  }

  return entries
}

/** `@scope/name/sub/path` → `@scope/name`, `name/sub` → `name` */
const packageName = (specifier: string) => {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

interface PackageJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readPackageJson = (dir: string): PackageJson => {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  )
  return parsed && typeof parsed === 'object' ? parsed : {}
}

/**
 * Package `name`, found the way Node finds a bare import from a file in
 * `dir`: its real folder, and the folder whose `node_modules` it was found
 * in (`dir` or one above it). Reads no `exports` map, so it also finds
 * packages that don't export their `package.json`.
 */
const findPackage = (
  name: string,
  dir: string,
): { realDir: string; foundIn: string } | null => {
  let current = dir
  for (;;) {
    const candidate = path.join(current, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return { realDir: fs.realpathSync(candidate), foundIn: current }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export interface SandboxChildImports {
  /** The child script's source file, which its imports resolve from */
  source: string
  /** What it imports: package names and Node builtins */
  imports: string[]
}

/**
 * Copies the packages the child scripts import, and everything those
 * depend on, into `<childrenDir>/node_modules`, so the folder runs on its
 * own wherever it's deployed: a serverless function's file tracing doesn't
 * follow a child script (nothing imports it), and it would miss what
 * native packages load at run time anyway (sharp's libvips).
 *
 * Follows each package's `dependencies`, and the `optionalDependencies`
 * and `peerDependencies` that are installed, which is how native packages
 * ship their platform's binaries (`@img/sharp-linux-x64`,
 * `@img/sharp-libvips-linux-x64`).
 *
 * The copy keeps each package's choices, so it finds the same versions
 * it does in the app: a dependency nested in a package's own
 * `node_modules` is copied into the copy's `node_modules`; one beside it
 * in a `node_modules` (pnpm's layout), or shadowed in the copy by another
 * version, goes next to the dependent's copy; one in the app's own
 * `node_modules` folders goes at the top. A package already reachable from
 * the dependent's copy is reused. When two versions would still need the
 * same place, it throws instead of letting one overwrite the other. So
 * does a package or regular dependency that isn't installed: the child
 * couldn't import it either.
 */
export function vendorSandboxChildPackages(
  childrenDir: string,
  children: SandboxChildImports[],
) {
  // Real package folder → where it was first copied
  const copyOf = new Map<string, string>()
  // Folder copied to → the real package folder copied there, and why
  const occupied = new Map<string, { realDir: string; neededBy: string }>()

  // A folder of the app that has packages of its own installed below it is
  // inside a node_modules (a package, or pnpm's .pnpm/<package> folder);
  // the others are the app's own folders (api/src, api, the root)
  const inNodeModules = (dir: string) =>
    dir.split(path.sep).includes('node_modules')

  // What Node would find for `name` from a package copied to `copy`: the
  // nearest copy in a node_modules from there up to the children's folder
  const reachableFrom = (copy: string, name: string) => {
    let dir = copy
    for (;;) {
      const there = occupied.get(path.join(dir, 'node_modules', name))
      if (there || dir === childrenDir) {
        return there?.realDir
      }
      dir = path.dirname(dir)
    }
  }

  const visit = (
    name: string,
    fromDir: string,
    dependentCopy: string,
    required: boolean,
    dependent: string,
  ) => {
    const found = findPackage(name, fromDir)
    if (!found) {
      if (required) {
        throw new Error(
          `Can't find package "${name}", which ${dependent} imports, in a ` +
            `node_modules folder above ${fromDir}`,
        )
      }
      return
    }

    const { realDir, foundIn } = found
    const reachable = reachableFrom(dependentCopy, name)
    if (reachable === realDir) {
      return
    }

    // Where the app has it, mirrored in the copy: in a copied package's own
    // node_modules; next to the dependent when found beside it in a
    // node_modules (pnpm's .pnpm/<package>/node_modules); at the top when
    // it's in one of the app's own node_modules folders. When the top
    // already has another version, next to the dependent too
    const copiedFolder = copyOf.get(foundIn)
    const besideDependent = path.join(dependentCopy, 'node_modules', name)
    const target = copiedFolder
      ? path.join(copiedFolder, 'node_modules', name)
      : inNodeModules(foundIn) || reachable
        ? besideDependent
        : path.join(childrenDir, 'node_modules', name)

    const there = occupied.get(target)
    if (there) {
      throw new Error(
        `Sandboxed child scripts need two versions of "${name}" in one ` +
          `place: ${there.realDir} (for ${there.neededBy}) and ${realDir} ` +
          `(for ${dependent}). Install a single version of it, or move the ` +
          'children so their imports resolve the same way.',
      )
    }

    occupied.set(target, { realDir, neededBy: dependent })
    if (!copyOf.has(realDir)) {
      copyOf.set(realDir, target)
    }
    fs.cpSync(realDir, target, {
      recursive: true,
      dereference: true,
      // Its own node_modules are copied as dependencies, when they're needed
      filter: (src) => src !== path.join(realDir, 'node_modules'),
    })

    const pkg = readPackageJson(realDir)
    const optional = new Set([
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ])
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      visit(dep, realDir, target, !optional.has(dep), name)
    }
    for (const dep of optional) {
      visit(dep, realDir, target, false, name)
    }
  }

  for (const { source, imports } of children) {
    for (const specifier of imports) {
      if (isBuiltin(specifier) || specifier.startsWith('#')) {
        continue
      }
      visit(
        packageName(specifier),
        fs.realpathSync(path.dirname(source)),
        childrenDir,
        true,
        path.basename(source),
      )
    }
  }
}

/** Every `*.func` folder under `dir`: Vercel's Build Output API functions */
const findVercelFunctionDirs = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          const entryPath = path.join(dir, entry.name)
          return entry.name.endsWith('.func')
            ? [entryPath]
            : findVercelFunctionDirs(entryPath)
        })
    : []

/**
 * Copies the bundled build's sandboxed children (and their `node_modules`)
 * into every Node function in a Vercel Build Output API folder
 * (`.vercel/output/functions/*.func`), at the same path as in the app
 * (`api/dist/ud/sandbox-children`). Each Vercel function is a single
 * bundled file with nothing else from the app, and `findChildScript()`
 * looks for the children from the function's folder up.
 */
export function copySandboxChildrenIntoVercelFunctions({
  appRoot,
  childrenDir,
  functionsDir,
}: {
  appRoot: string
  childrenDir: string
  functionsDir: string
}) {
  // At the same place in the function as in the app, where
  // findChildScript() looks for it
  const childrenDirInApp = path.relative(appRoot, childrenDir)

  if (!fs.existsSync(childrenDir)) {
    return []
  }

  const functionDirs = findVercelFunctionDirs(functionsDir).filter((dir) => {
    // Edge functions can't start processes
    const config = path.join(dir, '.vc-config.json')
    if (!fs.existsSync(config)) {
      return false
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(config, 'utf8'))
    return (
      !!parsed &&
      typeof parsed === 'object' &&
      'runtime' in parsed &&
      typeof parsed.runtime === 'string' &&
      parsed.runtime.startsWith('nodejs')
    )
  })

  for (const dir of functionDirs) {
    fs.cpSync(childrenDir, path.join(dir, childrenDirInApp), {
      recursive: true,
    })
  }

  return functionDirs
}
