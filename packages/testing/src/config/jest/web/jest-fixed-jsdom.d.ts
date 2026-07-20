// `jest-fixed-jsdom` ships no type declarations. It default-exports a class
// that extends `jest-environment-jsdom`'s `TestEnvironment` without adding to
// its public surface, so we can describe it as exactly that.
declare module 'jest-fixed-jsdom' {
  import { TestEnvironment } from 'jest-environment-jsdom'

  export default TestEnvironment
}
