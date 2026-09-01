import { describe, it, expect } from 'vitest'

import { resolveIdentityFields } from '../identity'
import { DEFAULT_OAUTH_IDENTITY_FIELDS } from '../types'

describe('resolveIdentityFields()', () => {
  it('returns the defaults when no fields are configured', () => {
    expect(resolveIdentityFields(undefined)).toEqual(
      DEFAULT_OAUTH_IDENTITY_FIELDS,
    )
  })

  it('overrides only the configured fields', () => {
    expect(resolveIdentityFields({ provider: 'oauthProvider' })).toEqual({
      ...DEFAULT_OAUTH_IDENTITY_FIELDS,
      provider: 'oauthProvider',
    })
  })

  it('does not let an explicitly-undefined field wipe its default', () => {
    // Simulates a caller spreading a partial config object where a key is
    // present but set to `undefined` (e.g. `{ provider: undefined, ...rest }`)
    // rather than omitted entirely.
    expect(
      resolveIdentityFields({
        provider: undefined,
        providerUserId: 'oauthProviderUserId',
      }),
    ).toEqual({
      ...DEFAULT_OAUTH_IDENTITY_FIELDS,
      providerUserId: 'oauthProviderUserId',
    })
  })
})
