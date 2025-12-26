test('Cedar is correctly tracking db imports 1', () => {
  // It'll currently be `undefined` here, but all that's important is that it's
  // falsy
  expect(globalThis.__cedarjs_db_imported__).toBeFalsy()
})
