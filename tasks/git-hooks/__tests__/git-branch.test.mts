import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, afterEach } from 'vitest'

import { getCurrentGitBranch } from '../git-branch.cjs'

function git(args: string[], cwd: string) {
  execSync(`git ${args.map((a) => `"${a}"`).join(' ')}`, { cwd, stdio: 'pipe' })
}

// A fresh repo in the OS temp dir, so that when a test walks up from a
// linked worktree it doesn't find this monorepo's own `.git` by accident.
function setupTestRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'git-branch-test-'))

  git(['init', '-b', 'main'], repoDir)
  git(['config', 'user.email', 'test@test.com'], repoDir)
  git(['config', 'user.name', 'Test'], repoDir)

  writeFileSync(join(repoDir, 'README.md'), '# repo\n')
  git(['add', 'README.md'], repoDir)
  git(['commit', '-m', 'init'], repoDir)

  return repoDir
}

describe('getCurrentGitBranch', () => {
  const dirsToClean: string[] = []

  afterEach(() => {
    for (const dir of dirsToClean.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns the checked out branch in a regular checkout', () => {
    const repoDir = setupTestRepo()
    dirsToClean.push(repoDir)

    expect(getCurrentGitBranch(repoDir)).toBe('main')

    git(['checkout', '-b', 'feature/thing'], repoDir)

    expect(getCurrentGitBranch(repoDir)).toBe('feature/thing')
  })

  it('returns the worktree branch, not the main checkout branch, in a linked worktree', () => {
    const repoDir = setupTestRepo()
    dirsToClean.push(repoDir)

    // Put the worktree outside the main repo so that `.git` is a `gitdir:`
    // file with no `.git/HEAD` anywhere in the worktree's ancestors
    const worktreeDir = mkdtempSync(join(tmpdir(), 'git-branch-test-wt-'))
    dirsToClean.push(worktreeDir)
    git(['worktree', 'add', '-b', 'wt-branch', worktreeDir], repoDir)

    expect(getCurrentGitBranch(worktreeDir)).toBe('wt-branch')
    expect(getCurrentGitBranch(repoDir)).toBe('main')

    // Subdirectories of the worktree resolve to the same branch
    const nested = join(worktreeDir, 'packages', 'foo')
    mkdirSync(nested, { recursive: true })
    expect(getCurrentGitBranch(nested)).toBe('wt-branch')
  })

  it('returns null for a detached HEAD', () => {
    const repoDir = setupTestRepo()
    dirsToClean.push(repoDir)

    git(['checkout', '--detach'], repoDir)

    expect(getCurrentGitBranch(repoDir)).toBeNull()
  })

  it('returns null outside of a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-branch-test-nogit-'))
    dirsToClean.push(dir)

    expect(getCurrentGitBranch(dir)).toBeNull()
  })
})
