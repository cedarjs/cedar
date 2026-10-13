import fs from 'node:fs'
import path from 'node:path'

/**
 * Where a bundled API build (`cedar build --ud`) puts every
 * `*.child.{ts,js}` script from `api/src`, as `<name>.child.js`, next to
 * the `node_modules` its imports need, relative to the app's root.
 * `@cedarjs/vite` writes it there.
 */
const SANDBOX_CHILDREN_DIR = path.join('api', 'dist', 'ud', 'sandbox-children')

/**
 * The bundled build's `<baseName>.js`, looked for from `dir` up: code in
 * the bundle runs from inside `api/dist/ud`, or, when a platform bundles
 * it again (Netlify) or copies it (Vercel), from another folder in the
 * deployed app, which keeps the app's layout.
 */
const findBundledChild = (dir: string, baseName: string) => {
  let current = dir
  for (;;) {
    const candidate = path.join(current, SANDBOX_CHILDREN_DIR, `${baseName}.js`)
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

/**
 * Finds a sandboxed child's script for the module that runs it. Call it
 * with `import.meta.dirname` and the script's name without extension, the
 * same way in every build:
 *
 * - from source (tests, `cedar exec`), `<baseName>.ts` (or `.js`) in
 *   `dir`, which Node runs by stripping its types;
 * - in a regular build, `<baseName>.js` in `dir`, where the build puts it
 *   next to its caller;
 * - in a bundled build (`cedar build --ud`, and so on Netlify and Vercel),
 *   where the caller is part of a bundle,
 *   `api/dist/ud/sandbox-children/<baseName>.js` in the app (looked for
 *   from `dir` up). A bundled build needs each child's name to be unique
 *   in `api/src`.
 *
 * Throws when there's no such script, so a build that lost it fails loudly
 * instead of running without it.
 *
 * Keep the child script plain enough to run as-is: no path aliases like
 * `src/…`, no TypeScript-only syntax such as enums, and imports of packages
 * only, never of your app's own modules.
 *
 * @example
 * ```ts
 * const script = findChildScript(import.meta.dirname, 'resize.child')
 * ```
 */
export const findChildScript = (dir: string, baseName: string): string => {
  for (const name of [`${baseName}.js`, `${baseName}.ts`]) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  const bundled = findBundledChild(dir, baseName)
  if (bundled) {
    return bundled
  }

  throw new Error(
    `findChildScript: no ${baseName}.js or ${baseName}.ts in ${dir}, and ` +
      `no ${path.join(SANDBOX_CHILDREN_DIR, `${baseName}.js`)} from it up`,
  )
}
