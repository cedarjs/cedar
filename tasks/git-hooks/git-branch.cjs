// @ts-check

const { spawnSync } = require('node:child_process')

/**
 * Returns the name of the branch checked out in `cwd`, or `null` when HEAD
 * is detached or `cwd` is not inside a git repository.
 *
 * Asks git rather than reading `.git/HEAD` directly: in a linked worktree
 * (`git worktree add`) `.git` is a file pointing at the main repository's
 * `.git/worktrees/<name>` directory, so `.git/HEAD` does not exist there.
 *
 * This file is CommonJS so that `yarn.config.cjs` can `require()` it.
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
function getCurrentGitBranch(cwd = process.cwd()) {
  const result = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
    cwd,
    encoding: 'utf-8',
  })

  if (result.error || result.status !== 0) {
    return null
  }

  const branch = result.stdout.trim()

  return branch || null
}

module.exports = { getCurrentGitBranch }
