import { TestEnvironment } from 'jest-environment-jsdom'

// Due to issue: https://github.com/jsdom/jsdom/issues/2524
// Fix from: https://github.com/jsdom/jsdom/issues/2524#issuecomment-736672511
module.exports = class RedwoodWebJestEnv extends TestEnvironment {
  async setup() {
    await super.setup()
    if (typeof this.global.TextEncoder === 'undefined') {
      const { TextEncoder, TextDecoder } = await import('node:util')
      this.global.TextEncoder = TextEncoder
      // @ts-expect-error - TextDecoder from node:utils is close enough
      this.global.TextDecoder = TextDecoder
    }
    if (typeof this.global.crypto.subtle === 'undefined') {
      // @ts-expect-error - we're just making sure the object is there
      this.global.crypto.subtle = {} // To make tests work with auth that use WebCrypto like auth0
    }
  }
}
