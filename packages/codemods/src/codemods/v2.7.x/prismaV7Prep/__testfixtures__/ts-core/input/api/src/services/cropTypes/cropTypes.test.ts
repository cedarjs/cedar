import type { CropType } from '@prisma/client'

import type { ScenarioData } from '@cedarjs/testing/api'

import {
  cropTypes,
  cropType,
  createCropType,
  updateCropType,
  deleteCropType,
} from './cropTypes'
import type { StandardScenario } from './cropTypes.scenarios'

// Generated boilerplate tests do not account for all circumstances
describe('cropTypes', () => {
  scenario('returns all cropTypes', async (scenario: StandardScenario) => {
    const result = await cropTypes()

    expect(result.length).toEqual(Object.keys(scenario.cropType).length)
  })

  scenario('returns a single cropType', async (scenario: StandardScenario) => {
    const result = await cropType({ id: scenario.cropType.one.id })

    expect(result).toEqual(scenario.cropType.one)
  })

  scenario(
    'creates a cropType',
    async (scenario: ScenarioData<CropType, 'cropType'>) => {
      const result = await createCropType({
        input: {
          name: 'Grain',
        },
      })

      expect(result.name).toEqual('Grain')
      expect(scenario.cropType.one.id).toBeTruthy()
    },
  )

  scenario('updates a cropType', async (scenario: StandardScenario) => {
    const original = await cropType({ id: scenario.cropType.one.id })
    const result = await updateCropType({
      id: original.id,
      input: { name: 'Updated Grain' },
    })

    expect(result.name).toEqual('Updated Grain')
  })

  scenario('deletes a cropType', async (scenario: StandardScenario) => {
    const original = await deleteCropType({ id: scenario.cropType.one.id })
    const result = await cropType({ id: original.id })

    expect(result).toEqual(null)
  })
})
