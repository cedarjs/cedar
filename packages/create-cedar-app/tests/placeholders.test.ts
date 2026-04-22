import fs from 'node:fs'
import path from 'node:path'

import { vol } from 'memfs'
import { afterEach, expect, it, vi } from 'vitest'

import type { ReplacementValues } from '../src/placeholders.js'
import { replacePlaceholders } from '../src/placeholders.js'

vi.mock('node:fs', async () => {
  const { fs: memfs } = await import('memfs')

  // memfs glob returns Promise<string[]> but Node's fs.promises.glob returns
  // AsyncIterator<string>. Wrap it to match the expected interface.
  // See: https://github.com/streamich/memfs/issues/1161
  async function* glob(
    ...args: Parameters<typeof memfs.promises.glob>
  ): AsyncGenerator<string> {
    yield* await (memfs.promises.glob(...args) as unknown as Promise<string[]>)
  }

  const patchedPromises = { ...memfs.promises, glob }
  const patchedFs = { ...memfs, promises: patchedPromises }

  return { default: patchedFs, ...patchedFs }
})

const DEFAULT_VALUES: ReplacementValues = {
  packageManager: 'yarn',
  databaseUrl: 'file:./dev.db',
  directDatabaseUrl: 'file:./dev.db',
  neonClaimExpiry: '3600',
  neonClaimUrl: 'https://example.com/claim',
}

const TEST_DIR = '/test'

afterEach(() => {
  vol.reset()
})

it('replaces package manager placeholders in a json file', async () => {
  vol.fromJSON({
    [path.join(TEST_DIR, 'package.json')]: JSON.stringify({
      packageManager: '{{PM}}',
      scripts: {
        install: '{{PM_INSTALL}}',
        cedar: '{{CEDAR_CLI}}',
      },
    }),
  })

  await replacePlaceholders(TEST_DIR, {
    ...DEFAULT_VALUES,
    packageManager: 'pnpm',
  })

  const content = await fs.promises.readFile(
    path.join(TEST_DIR, 'package.json'),
    'utf-8',
  )
  const parsed = JSON.parse(content)

  expect(parsed.packageManager).toBe('pnpm')
  expect(parsed.scripts.install).toBe('pnpm install')
  expect(parsed.scripts.cedar).toBe('pnpm cedar')
})

it('replaces database URL placeholders in a .env file', async () => {
  const databaseUrl = 'postgresql://user:pass@localhost:5432/mydb'
  const directDatabaseUrl =
    'postgresql://user:pass@localhost:5432/mydb?connect_timeout=15'

  vol.fromJSON({
    [path.join(TEST_DIR, '.env')]: [
      'DATABASE_URL={{DATABASE_URL}}',
      'DIRECT_URL={{DIRECT_DATABASE_URL}}',
    ].join('\n'),
  })

  await replacePlaceholders(TEST_DIR, {
    ...DEFAULT_VALUES,
    databaseUrl,
    directDatabaseUrl,
  })

  const content = await fs.promises.readFile(
    path.join(TEST_DIR, '.env'),
    'utf-8',
  )

  expect(content).toContain(`DATABASE_URL=${databaseUrl}`)
  expect(content).toContain(`DIRECT_URL=${directDatabaseUrl}`)
})

it('replaces Neon claim placeholders in a ts file', async () => {
  const neonClaimExpiry = '7200'
  const neonClaimUrl = 'https://neon.tech/claim/abc-123'

  vol.fromJSON({
    [path.join(TEST_DIR, 'neon.ts')]: [
      'const claimExpiry = "{{NEON_CLAIM_EXPIRY}}"',
      'const claimUrl = "{{NEON_CLAIM_URL}}"',
    ].join('\n'),
  })

  await replacePlaceholders(TEST_DIR, {
    ...DEFAULT_VALUES,
    neonClaimExpiry,
    neonClaimUrl,
  })

  const content = await fs.promises.readFile(
    path.join(TEST_DIR, 'neon.ts'),
    'utf-8',
  )

  expect(content).toContain(`"${neonClaimExpiry}"`)
  expect(content).toContain(`"${neonClaimUrl}"`)
})
