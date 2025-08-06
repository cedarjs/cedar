import { TestEnvironment } from 'jest-environment-jsdom'

// Due to issue: https://github.com/jsdom/jsdom/issues/2524
// Fix from: https://github.com/jsdom/jsdom/issues/2524#issuecomment-736672511
class RedwoodWebJestEnvironment extends TestEnvironment {
  async setup(): Promise<void> {
    await super.setup()
    if (typeof this.global.TextEncoder === 'undefined') {
      const { TextEncoder, TextDecoder } = require('node:util')
      this.global.TextEncoder = TextEncoder
      this.global.TextDecoder = TextDecoder
    }
    if (typeof this.global.crypto.subtle === 'undefined') {
      // @ts-expect-error - To make tests work with auth that use WebCrypto like auth0
      this.global.crypto.subtle = {}
    }
  }
}

module.exports = RedwoodWebJestEnvironment
