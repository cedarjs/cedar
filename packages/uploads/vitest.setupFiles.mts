import { afterEach } from 'vitest'

afterEach(async () => {
  // Web tests (files marked with `@vitest-environment jsdom`) use
  // @testing-library/react, which needs an explicit cleanup because vitest
  // globals are not enabled. The import is dynamic so that node-environment
  // test files do not pull in the DOM testing library.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  }
})
