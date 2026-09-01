import { beforeAll } from 'vitest'

import {
  hasGitHubAppCredentials,
  hasGitHubToken,
  hasGoogleAppCredentials,
  hasGoogleRefreshToken,
} from './env.mts'

beforeAll(() => {
  console.log('Provider contract tests — tier status:')
  console.log('  Tier 1 (zero credentials): always runs')
  console.log(
    `  Tier 2 (app credentials): GitHub ${
      hasGitHubAppCredentials ? 'enabled' : 'skipped (env unset)'
    }, Google ${hasGoogleAppCredentials ? 'enabled' : 'skipped (env unset)'}`,
  )
  console.log(
    `  Tier 3 (non-interactive tokens): GitHub ${
      hasGitHubToken ? 'enabled' : 'skipped (env unset)'
    }, Google ${hasGoogleRefreshToken ? 'enabled' : 'skipped (env unset)'}`,
  )
})
