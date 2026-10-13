export {}

declare global {
  // Set by Cedar's vitest setup when a test file imports the database
  // eslint-disable-next-line no-var
  var __cedarjs_db_imported__: boolean | undefined
}

test('Cedar is correctly tracking db imports 1', () => {
  // It'll currently be `undefined` here, but all that's important is that it's
  // falsy
  expect(globalThis.__cedarjs_db_imported__).toBeFalsy()
})
