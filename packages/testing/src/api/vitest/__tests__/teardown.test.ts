import { describe, expect, it } from 'vitest'

import {
  emptyTablesInWorkingOrder,
  isHandledTeardownError,
} from '../teardown.js'

/**
 * The shape Prisma reports a driver error in, taken from a real
 * `DELETE FROM` against a row another table still references.
 */
const driverError = (
  kind: string,
  { originalMessage = 'FOREIGN KEY constraint failed' } = {},
) =>
  Object.assign(
    new Error(
      'Invalid `prisma.$executeRawUnsafe()` invocation:\n\n' +
        `Raw query failed. Code: \`SQLITE_CONSTRAINT_TRIGGER\`. Message: \`${originalMessage}\``,
    ),
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            kind,
            originalCode: 'SQLITE_CONSTRAINT_TRIGGER',
            originalMessage,
          },
        },
      },
    },
  )

const foreignKeyError = () => driverError('ForeignKeyConstraintViolation')

describe('isHandledTeardownError', () => {
  it('recognises a row another table still references', () => {
    expect(isHandledTeardownError(foreignKeyError())).toBe(true)
  })

  it('recognises a constraint that restricts the delete', () => {
    expect(isHandledTeardownError(driverError('RestrictViolation'))).toBe(true)
  })

  it('does not recognise a constraint no ordering fixes', () => {
    expect(
      isHandledTeardownError(driverError('UniqueConstraintViolation')),
    ).toBe(false)
    expect(isHandledTeardownError(driverError('TableDoesNotExist'))).toBe(false)
  })

  it('does not recognise an error that never reached the driver', () => {
    expect(isHandledTeardownError(new Error('connection closed'))).toBe(false)
  })

  it('does not recognise a value that is not an error', () => {
    expect(isHandledTeardownError(undefined)).toBe(false)
    expect(isHandledTeardownError('ForeignKeyConstraintViolation')).toBe(false)
    expect(isHandledTeardownError({ meta: null })).toBe(false)
  })
})

describe('emptyTablesInWorkingOrder', () => {
  it('empties every table and keeps the order when nothing blocks', async () => {
    const emptied: string[] = []

    const order = await emptyTablesInWorkingOrder(
      ['Post', 'User'],
      async (modelName) => {
        emptied.push(modelName)
      },
    )

    expect(emptied).toEqual(['Post', 'User'])
    expect(order).toEqual(['Post', 'User'])
  })

  it('defers a table a foreign key blocks, and reports the order that worked', async () => {
    const emptied: string[] = []

    // `User` can only be emptied once `Post` is, which the given order has
    // backwards.
    const order = await emptyTablesInWorkingOrder(
      ['User', 'Post'],
      async (modelName) => {
        if (modelName === 'User' && !emptied.includes('Post')) {
          throw foreignKeyError()
        }

        emptied.push(modelName)
      },
    )

    expect(emptied).toEqual(['Post', 'User'])
    expect(order).toEqual(['Post', 'User'])
  })

  it('raises the error instead of deferring forever when no order works', async () => {
    let attempts = 0

    const run = emptyTablesInWorkingOrder(['A', 'B'], async () => {
      attempts++
      throw foreignKeyError()
    })

    await expect(run).rejects.toMatchObject({ code: 'P2010' })
    // One pass over both tables, then the third failure ends it rather than
    // appending the same table forever.
    expect(attempts).toBe(3)
  })

  it('still raises when tables that empty successfully keep landing between the attempts', async () => {
    let attempts = 0
    const alreadyTried = new Set<string>()

    // Every table but `Blocked` fails once and succeeds on its second
    // attempt, so a successful delete keeps landing between `Blocked`'s
    // attempts. Deferring appends to the order being walked, so this has to
    // end in the error rather than in a growing order.
    const run = emptyTablesInWorkingOrder(
      ['Post', 'Blocked', 'Tag', 'User'],
      async (modelName) => {
        attempts++

        if (modelName === 'Blocked' || !alreadyTried.has(modelName)) {
          alreadyTried.add(modelName)
          throw foreignKeyError()
        }
      },
    )

    await expect(run).rejects.toMatchObject({ code: 'P2010' })
    // Four tables deferred once each, then three of them empty on their
    // second attempt, then `Blocked` is deferred once more per table still
    // waiting and raises on the attempt after that.
    expect(attempts).toBe(10)
  })

  it('raises an error that no reordering can fix straight away', async () => {
    let attempts = 0

    const run = emptyTablesInWorkingOrder(['A', 'B'], async () => {
      attempts++
      throw driverError('TableDoesNotExist')
    })

    await expect(run).rejects.toMatchObject({ code: 'P2010' })
    expect(attempts).toBe(1)
  })
})
