import { validateEmail } from './index.js'

describe('validators', () => {
  it('should not throw any errors', async () => {
    expect(validateEmail('valid@email.com')).not.toThrow()
  })
})
