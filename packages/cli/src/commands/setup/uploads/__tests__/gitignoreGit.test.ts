import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import execa from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findIgnoredPaths } from '../gitignore.js'

// Runs against a real git repository, because the exact `git check-ignore`
// flag combination can't be verified with a mocked `execa`.
describe('findIgnoredPaths with git', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-gitignore-')),
    )
    await execa('git', ['init', '-q'], { cwd: projectDir })
    fs.writeFileSync(path.join(projectDir, '.gitignore'), 'uploads\nü\n')
  })

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('returns only the ignored paths, unquoted', async () => {
    const ignored = [
      path.join(projectDir, 'api/src/services/uploads/uploads.ts'),
      path.join(projectDir, 'api/ü/a.ts'),
    ]
    const tracked = path.join(projectDir, 'api/src/server.ts')

    const result = await findIgnoredPaths(projectDir, [...ignored, tracked])

    // Git may report Windows paths with forward slashes
    expect(result.map((p) => path.resolve(p))).toEqual(ignored)
  })
})
