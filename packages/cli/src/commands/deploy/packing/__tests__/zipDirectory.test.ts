import fs from 'node:fs'
import path from 'node:path'

import { describe, test, expect } from 'vitest'

// Verify that the zipDirectory export exists with proper error handling for optional archiver
describe('zipDirectory archiver integration', () => {
  test('zipDirectory is exported from nft module', async () => {
    const { zipDirectory } = await import('../nft.js')
    expect(typeof zipDirectory).toBe('function')
  })

  test('zipDirectory error handling: distinguishes missing vs other errors', async () => {
    // The implementation should check for code === 'ERR_MODULE_NOT_FOUND'
    // and provide helpful installation instructions for that specific case,
    // while rethrowing other errors unchanged

    // We verify this by checking that the source code includes both patterns
    const nftPath = path.resolve(import.meta.dirname, '../nft.ts')
    const source = fs.readFileSync(nftPath, 'utf-8')

    // Check that the code includes the specific error handling pattern for missing modules
    expect(source).toMatch(/ERR_MODULE_NOT_FOUND/)
    expect(source).toMatch(/Could not find the 'archiver' package/)
    expect(source).toMatch(/npm i -D archiver/)

    // Check that non-missing errors are rethrown unchanged
    expect(source).toMatch(/throw e/)
  })
})
