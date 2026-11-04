import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

// The a11y layout template imports `@cedarjs/router/skip-nav.css`. The file
// ships in the package, but it is only importable when the package `exports`
// map lists the subpath. Node and Vite both resolve subpaths through
// `exports`, so a missing entry fails the import in generated apps
// (ERR_PACKAGE_PATH_NOT_EXPORTED / "Missing ./skip-nav.css specifier").
// https://github.com/cedarjs/cedar/issues/3286
describe('skip-nav.css export', () => {
  it('is exported from the package', () => {
    expect(() =>
      createRequire(import.meta.url).resolve('@cedarjs/router/skip-nav.css'),
    ).not.toThrow()
  })
})
