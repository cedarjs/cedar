import { validateEmail } from './index.js'

describe('validators', () => {
  it('returns true for a valid email', () => {
    expect(validateEmail('valid@email.com')).toBe(true)
  })
})
