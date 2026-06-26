import type { Contact } from 'src/lib/db'

import {
  contacts,
  contact,
  createContact,
  updateContact,
  deleteContact,
} from './contacts.js'
import type { StandardScenario } from './contacts.scenarios.js'

// Generated boilerplate tests do not account for all circumstances
// and can fail without adjustments, e.g. Float.
//           Please refer to the RedwoodJS Testing Docs:
//       https://cedarjs.com/docs/testing#testing-services
// https://cedarjs.com/docs/testing#jest-expect-type-considerations

describe('contacts', () => {
  afterEach(() => {
    jest.mocked(console).log.mockRestore?.()
  })

  scenario('returns all contacts', async (scenario: StandardScenario) => {
    const result = await contacts()

    expect(result.length).toEqual(Object.keys(scenario.contact).length)
  })

  scenario('returns a single contact', async (scenario: StandardScenario) => {
    const result = await contact({ id: scenario.contact.one.id })

    expect(result).toEqual(scenario.contact.one)
  })

  scenario('creates a contact', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})

    const result = await createContact({
      input: { name: 'String', email: 'foo@bar.com', message: 'String' },
    })

    expect(result.name).toEqual('String')
    expect(result.email).toEqual('foo@bar.com')
    expect(result.message).toEqual('String')
  })

  scenario('updates a contact', async (scenario: StandardScenario) => {
    const original = (await contact({ id: scenario.contact.one.id })) as Contact
    const result = await updateContact({
      id: original.id,
      input: { name: 'String2' },
    })

    expect(result.name).toEqual('String2')
  })

  scenario('deletes a contact', async (scenario: StandardScenario) => {
    const original = (await deleteContact({
      id: scenario.contact.one.id,
    })) as Contact
    const result = await contact({ id: original.id })

    expect(result).toEqual(null)
  })
})
