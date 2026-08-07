import { user } from './users.js'
import type { StandardScenario } from './users.scenarios.js'

describe('users', () => {
  scenario('returns a single user', async (scenario: StandardScenario) => {
    const result = await user({ id: scenario.user.one.id })

    expect(result).toEqual(scenario.user.one)
  })
})
