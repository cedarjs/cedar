// The Windows CI legs are expensive and (per
// docs/implementation-plans/flaky-smoke-tests-investigation.md) the flakiest
// part of CI, so they only run on PRs that plausibly affect Windows behavior.
// Historically that means path handling: separators, drive letters/file URLs,
// spawn quoting, and file locking. Two signals, calibrated against 12
// historical Windows-fix PRs (all 12 would have triggered a Windows run) and
// against the last 100 merged PRs (~35% of them skip Windows entirely):
//
// 1. The added lines of the PR diff use a path- or process-sensitive API.
// 2. The PR touches packages/cli, packages/cli-helpers, or packages/vite
//    (the packages with the most Windows history — cli-helpers holds the
//    process-spawning/package-manager-shim machinery; also covers Windows
//    bugs that no grep can see, like a bad path inside an HTML template
//    string).
//
// A daily full Windows run on main (nightly-windows.yml) catches anything
// that slips through, and the `windows` label on a PR forces the full matrix.

const WINDOWS_SENSITIVE_PATTERN = new RegExp(
  [
    'path\\.(join|resolve|relative|normalize|sep|isAbsolute|posix|win32|delimiter|basename)',
    'normalizePath',
    '__dirname',
    '__filename',
    'import\\.meta\\.url',
    'fileURLToPath',
    'pathToFileURL',
    'file://',
    // An escaped backslash in source code, i.e. a Windows path literal
    '\\\\\\\\',
    'process\\.cwd',
    'homedir',
    'tmpdir',
    'TMPDIR',
    'USERPROFILE',
    'renameSync',
    '[^a-zA-Z]rename\\(',
    '[^a-zA-Z]spawn',
    '[^a-zA-Z]execa?[( ]',
    '\\.cmd[^a-zA-Z]',
  ].join('|'),
)

const ALWAYS_RUN_PACKAGES = /^packages\/(cli|cli-helpers|vite)\//

const CODE_FILE = /\.[mc]?[jt]sx?$/

export interface PrFile {
  filename: string
  /** Unified diff for the file. Absent for binary files and for very large diffs. */
  patch?: string
}

/**
 * Decides whether the Windows CI legs should run for this PR.
 *
 * Always evaluates the full PR diff (not just the files changed since the
 * last CI run) so that a path-sensitive change in an early commit keeps the
 * Windows legs running on later pushes too.
 *
 * @param prFiles All files changed in the PR, with patches
 * @returns True if the Windows legs should run
 */
export function windowsChanged(prFiles: PrFile[]): boolean {
  for (const file of prFiles) {
    if (ALWAYS_RUN_PACKAGES.test(file.filename)) {
      console.log('Windows-relevant package change detected:', file.filename)
      return true
    }
  }

  for (const file of prFiles) {
    if (!CODE_FILE.test(file.filename)) {
      continue
    }

    // No patch for a code file means the diff was too large to include —
    // we can't inspect it, so err on the side of running Windows
    if (!file.patch) {
      console.log('Code file with no patch (too large?):', file.filename)
      return true
    }

    const matchedLine = file.patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .find((line) => WINDOWS_SENSITIVE_PATTERN.test(line))

    if (matchedLine) {
      console.log(
        `Windows-sensitive change detected in ${file.filename}:`,
        matchedLine.trim(),
      )
      return true
    }
  }

  console.log('No Windows-relevant changes')
  return false
}
