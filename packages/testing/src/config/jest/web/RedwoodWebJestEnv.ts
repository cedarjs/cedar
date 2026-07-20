import JSDOMEnvironment from 'jest-fixed-jsdom'

// `jest-environment-jsdom` gives you a broken environment: it removes Node
// globals that exist in both Node and the browser (`fetch`, `Request`,
// `Response`, `ReadableStream`, `TextEncoder`, ...) or replaces them with
// jsdom polyfills that don't behave identically (`structuredClone`,
// `AbortSignal`, ...).
//
// MSW v2 needs the real ones — its `HttpResponse` extends the global
// `Response`, so merely importing `msw` throws without them. `jest-fixed-jsdom`
// (maintained by the MSW team) restores them, and also opts out of jsdom's
// browser-style export condition resolution, which is what makes `msw/node`
// resolvable at all (MSW marks it `"browser": null`).
//
// See https://github.com/mswjs/jest-fixed-jsdom. Note their warning: this is a
// workaround for jsdom, not a solution. Testing browser code in an actual
// browser (Vitest browser mode, Playwright) avoids this class of problem
// entirely.
class RedwoodWebJestEnvironment extends JSDOMEnvironment {
  async setup() {
    await super.setup()

    if (typeof this.global.crypto.subtle === 'undefined') {
      // @ts-expect-error - We're just making sure the object is there to make
      // tests work with auth that use WebCrypto like auth0
      this.global.crypto.subtle = {}
    }
  }
}

export default RedwoodWebJestEnvironment
