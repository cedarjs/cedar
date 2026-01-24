import { getDirectiveName } from '@cedarjs/testing/api'

import skipAuth from './skipAuth.js'

describe('skipAuth directive', () => {
  it('declares the directive sdl as schema, with the correct name', () => {
    expect(skipAuth.schema).toBeTruthy()
    expect(getDirectiveName(skipAuth.schema)).toBe('skipAuth')
  })
})
