import { fs as memfsFs } from 'memfs'

/**
 * A stand-in for `fs.globSync` to use in a `vi.mock('node:fs', ...)` factory
 * alongside memfs, in place of memfs's own `globSync`.
 *
 * memfs's `globSync` doesn't agree with real `path.win32.join` on a Windows
 * runner. A file planted via `vol.fromJSON` and found fine everywhere else
 * silently doesn't turn up. `readdirSync`, used here instead, doesn't have
 * that problem: unlike `globSync`, it hands back bare filenames with no path
 * joining of its own, so every path is built by this file, not memfs.
 *
 * Only supports what's needed to stand in for `fs.globSync(pattern, { cwd })`
 * with an extension-only glob like `'**\/*.{ts,tsx,js,jsx}'` where it matches
 * by extension and ignores the rest of the pattern.
 */
export function globSyncByExtension(
  cwd: string,
  extensions: readonly string[],
): string[] {
  const pattern = new RegExp(`\\.(${extensions.join('|')})$`)
  const results: string[] = []

  const walk = (dir: string, relativeDir: string) => {
    for (const entry of memfsFs.readdirSync(dir, { withFileTypes: true })) {
      // memfs's `readdirSync` type is `TDataOut[] | Dirent[]` regardless of
      // `withFileTypes` — it doesn't narrow on the literal like Node's own
      // overloads do — so `entry` is typed as `string | Buffer | Dirent`
      // here even though it's always a `Dirent` at runtime, given
      // `withFileTypes: true`.
      if (typeof entry === 'string' || Buffer.isBuffer(entry)) {
        continue
      }

      const name = entry.name.toString()
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name

      if (entry.isDirectory()) {
        walk(`${dir}/${name}`, relativePath)
      } else if (pattern.test(name)) {
        results.push(relativePath)
      }
    }
  }

  walk(cwd.replaceAll('\\', '/'), '')

  return results
}
