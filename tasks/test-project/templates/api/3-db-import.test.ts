test('Cedar is correctly tracking db imports 3', () => {
  // The previous test (2-db-import.test.ts) imported the database but this one
  // doesn't, so __cedarjs_db_imported__ should be falsy again
  expect(globalThis.__cedarjs_db_imported__).toBeFalsy()
})
