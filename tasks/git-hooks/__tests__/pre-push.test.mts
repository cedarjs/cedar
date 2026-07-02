import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const monorepoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const hookScript = join(monorepoRoot, 'tasks', 'git-hooks', 'pre-push.mts')
const testReposRoot = join(monorepoRoot, 'tmp', 'pre-push-test-repos')

function git(args: string[], cwd: string) {
  execSync(`git ${args.map((a) => `"${a}"`).join(' ')}`, { cwd, stdio: 'pipe' })
}

function setupTestRepo(name: string): string {
  const repoDir = join(testReposRoot, name)
  mkdirSync(repoDir, { recursive: true })

  git(['init'], repoDir)
  git(['config', 'user.email', 'test@test.com'], repoDir)
  git(['config', 'user.name', 'Test'], repoDir)

  writeFileSync(join(repoDir, 'README.md'), '# repo\n')
  git(['add', 'README.md'], repoDir)
  git(['commit', '-m', 'init'], repoDir)

  return repoDir
}

describe('pre-push hook', () => {
  it('skips on the next branch', () => {
    const repoDir = setupTestRepo('skip-next')

    try {
      git(['checkout', '-b', 'next'], repoDir)

      const result = execSync(`node "${hookScript}"`, {
        cwd: repoDir,
        encoding: 'utf-8',
      })

      expect(result).toBeDefined()
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('skips on a release/ branch', () => {
    const repoDir = setupTestRepo('skip-release')

    try {
      git(['checkout', '-b', 'release/v2'], repoDir)

      const result = execSync(`node "${hookScript}"`, {
        cwd: repoDir,
        encoding: 'utf-8',
      })

      expect(result).toBeDefined()
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
