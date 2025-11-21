import { vi } from 'vitest'

// Mock fs before anything else gets imported
// We need to duplicate this for both 'fs' and 'node:fs' to ensure both are mocked
vi.mock('node:fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  return {
    ...memfs.fs,
    default: memfs.fs,
  }
})

vi.mock('fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  return {
    ...memfs.fs,
    default: memfs.fs,
  }
})
