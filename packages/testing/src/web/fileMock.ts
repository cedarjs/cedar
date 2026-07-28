/**
 * Lets Jest gracefully handle asset files such as stylesheets and images.
 * Usually, these files aren't particularly useful in tests so we can safely
 * mock them out. Asset imports are mapped to this module by the
 * `moduleNameMapper` config in
 * `packages/testing/src/config/jest/web/jest-preset.ts`.
 */
export default 'fileMock'
