import { vi } from 'vitest'

// Mock fs before anything else gets imported
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
