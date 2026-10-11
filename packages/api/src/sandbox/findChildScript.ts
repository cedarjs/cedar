import fs from 'node:fs'
import path from 'node:path'

/**
 * Finds a sandboxed child's script next to the module that runs it:
 * `<baseName>.js` (what a build outputs), or `<baseName>.ts` when running
 * from source (tests, `cedar exec`), which Node runs by stripping its
 * types. Null when neither exists.
 *
 * Keep the child script plain enough to run as-is: no path aliases like
 * `src/…`, no TypeScript-only syntax such as enums, and only imports of
 * packages it's given read access to.
 *
 * @example
 * ```ts
 * const script = findChildScript(import.meta.dirname, 'resize.child')
 * ```
 */
export const findChildScript = (
  dir: string,
  baseName: string,
): string | null => {
  for (const name of [`${baseName}.js`, `${baseName}.ts`]) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}
