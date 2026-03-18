import { describe, it, expect } from 'vitest'

import { hasUnexpandedPathParams } from '../prerenderHandler.js'

describe('hasUnexpandedPathParams', () => {
  it('detects multiple params in the same path', () => {
    expect(hasUnexpandedPathParams('/posts/{year:Int}/{slug}')).toBe(true)
  })

  it('returns false when the param placeholder has been replaced by a number', () => {
    expect(hasUnexpandedPathParams('/blog-post/42')).toBe(false)
  })
})
