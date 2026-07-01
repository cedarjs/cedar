import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const monorepoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const scriptPath = join(monorepoRoot, 'tasks', 'smart-format.mts')

describe('smart-format with space-containing paths', () => {
  it('handles filenames with spaces', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'smart-format-test-'))
    const filePath = join(tmpDir, 'hello world.ts')
    writeFileSync(filePath, 'const  x:   number  =   1\n')

    try {
      const result = execSync(`node "${scriptPath}" "${filePath}"`, {
        cwd: monorepoRoot,
        encoding: 'utf-8',
      })

      expect(result).toBeDefined()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
