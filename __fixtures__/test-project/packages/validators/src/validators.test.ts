import { validators } from './index.js'

describe('validators', () => {
  it('should not throw any errors', async () => {
    expect(validators()).not.toThrow()
  })
})
