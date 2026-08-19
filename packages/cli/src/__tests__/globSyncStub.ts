import { fs as memfsFs } from 'memfs'

/**
 * A stand-in for `fs.globSync` to use in a `vi.mock('node:fs', ...)` factory
 * alongside memfs, in place of memfs's own `globSync`.
 *
 * memfs's `globSync` doesn't agree with real `path.win32.join` on a Windows
 * runner. A file planted via `vol.fromJSON` and found fine everywhere else
 * silently doesn't turn up. `readdirSync`, used here instead, doesn't have
 * that problem: unlike `globSync`, it hands back bare filenames with no path
 * joining of its own, so every path is built by this file, not memfs. This is
 * by design, not an oversight: per https://github.com/streamich/memfs/pull/1144
 * (the PR that added `globSync`/`glob`/`promises.glob` to memfs), "[t]he
 * implementation ensures consistent behavior across all platforms by using
 * POSIX path handling internally. This prevents issues where Windows systems
 * would return `D:\test\file1.js` instead of `/test/file1.js` for absolute
 * patterns, maintaining memfs's platform-agnostic behavior." A real,
 * backslash-joined Windows path (which is what `path.join(...)` inside
 * `hasSqliteUsageOutsideDb` produces on win32 platforms) doesn't resolve
 * against that POSIX-only internal representation.
 * See also https://github.com/streamich/memfs/issues/316, the same
 * POSIX-vs-real-path mismatch in `realpathSync`, closed as "not planned".
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
    // Real `fs.globSync` returns no matches for a `cwd` that doesn't exist,
    // rather than throwing — `readdirSync` throws ENOENT instead, so that
    // has to be handled explicitly here to match.
    if (!memfsFs.existsSync(dir)) {
      return
    }

    for (const entry of memfsFs.readdirSync(dir, { withFileTypes: true })) {
      // memfs's `readdirSync` type is `TDataOut[] | Dirent[]` regardless of
      // `withFileTypes`. It doesn't narrow on the literal like Node's own
      // overloads do, so `entry` is typed as `string | Buffer | Dirent`
      // here even though it's always a `Dirent` at runtime when used with
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
