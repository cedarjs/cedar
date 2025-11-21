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

// fs-extra adds additional methods like outputFileSync on top of fs
// We need to implement outputFileSync which creates parent directories automatically
vi.mock('fs-extra', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  const path = await vi.importActual<typeof import('path')>('path')
  
  // outputFileSync creates parent directories if they don't exist
  const outputFileSync = (file: string, data: any, options?: any) => {
    const dir = path.dirname(file)
    memfs.fs.mkdirSync(dir, { recursive: true })
    memfs.fs.writeFileSync(file, data, options)
  }
  
  return {
    ...memfs.fs,
    outputFileSync,
    default: {
      ...memfs.fs,
      outputFileSync,
    },
  }
})
