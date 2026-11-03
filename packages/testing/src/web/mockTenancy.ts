import type { Tenancy } from '@cedarjs/router'

/**
 * The `tenancy` passed to the app's `<Router>`. `MockRouter` records it when
 * `MockProviders` renders the app's routes, and `MockOrgProvider` uses it.
 */
export const mockedTenancyMeta: { tenancy: Tenancy | undefined } = {
  tenancy: undefined,
}
