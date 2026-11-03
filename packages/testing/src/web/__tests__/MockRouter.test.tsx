import React from 'react'

import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

// Private is deprecated, but we still want to test it so we don't break
// people's projects that still use it.
import { Route, Private } from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'

import { routes, Router } from '../MockRouter'
import { mockedTenancyMeta } from '../mockTenancy'

const FakePage = () => <></>

describe('MockRouter', () => {
  it('should correctly map routes', () => {
    render(
      <Router>
        <Route name="a" path="/a" page={FakePage} />
        <Route name="b" path="/b" page={FakePage} />
        <Private unauthenticated="a">
          <Route name="c" path="/c" page={FakePage} />
          <Route name="d" path="/d" page={FakePage} />
        </Private>
      </Router>,
    )

    expect(Object.keys(routes)).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 'd']),
    )
  })

  it("records the app's tenancy", () => {
    const tenancy: Tenancy = {
      useOrg: () => null,
      OrgProvider: ({ children }) => <>{children}</>,
    }
    // `tenancy` is only in `RouterProps` in an app with tenancy, and this
    // package isn't one, so it's passed the way any extra prop would be
    const tenancyProps = { tenancy }

    render(
      <Router {...tenancyProps}>
        <Route name="a" path="/a" page={FakePage} />
      </Router>,
    )

    expect(mockedTenancyMeta.tenancy).toBe(tenancy)
  })
})
