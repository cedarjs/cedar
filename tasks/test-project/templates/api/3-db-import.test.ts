export {}

declare global {
  // Set by Cedar's vitest setup when a test file imports the database
  // eslint-disable-next-line no-var
  var __cedarjs_db_imported__: boolean | undefined
}

test('Cedar is correctly tracking db imports 3', () => {
  // The previous test (2-db-import.test.ts) imported the database but this one
  // doesn't, so __cedarjs_db_imported__ should be falsy again
  expect(globalThis.__cedarjs_db_imported__).toBeFalsy()
})
