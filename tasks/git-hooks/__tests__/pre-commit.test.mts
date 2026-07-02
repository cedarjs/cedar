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
const hookScript = join(monorepoRoot, 'tasks', 'git-hooks', 'pre-commit.mts')
const testReposRoot = join(monorepoRoot, 'tmp', 'pre-commit-test-repos')

function git(args: string[], cwd: string) {
  execSync(`git ${args.map((a) => `"${a}"`).join(' ')}`, { cwd, stdio: 'pipe' })
}

function setupTestRepo(name: string): string {
  const repoDir = join(testReposRoot, name)
  mkdirSync(repoDir, { recursive: true })

  git(['init'], repoDir)
  git(['config', 'user.email', 'test@test.com'], repoDir)
  git(['config', 'user.name', 'Test'], repoDir)

  // An initial commit is needed so git diff --cached works reliably
  writeFileSync(join(repoDir, 'README.md'), '# repo\n')
  git(['add', 'README.md'], repoDir)
  git(['commit', '-m', 'init'], repoDir)

  return repoDir
}

describe('pre-commit hook', () => {
  it('exits successfully on staged clean files', { timeout: 30_000 }, () => {
    const repoDir = setupTestRepo('clean-files')

    try {
      // Create a clean .ts file and stage it
      writeFileSync(
        join(repoDir, 'greet.ts'),
        'export const greet = (name: string) => `Hello ${name}`\n',
      )
      git(['add', 'greet.ts'], repoDir)

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
