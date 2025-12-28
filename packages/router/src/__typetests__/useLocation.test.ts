import { expect, test } from 'tstyche'

import { useLocation } from '@cedarjs/router'

test('useLocation types', () => {
  const location = useLocation()

  // Useful with SSR!
  expect(location.origin).type.toBe<string>()
  expect(location.host).type.toBe<string>()
  expect(location.protocol).type.toBe<string>()

  // The original definition of useLocation, that returned a "partial" location
  expect(location.pathname).type.toBe<string>()
  expect(location.search).type.toBe<string>()
  expect(location.hash).type.toBe<string>()
})
