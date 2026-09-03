import { describe, expect, it } from 'vitest'

import {
  emptyTablesInWorkingOrder,
  isHandledTeardownError,
} from '../teardown.js'

const prismaError = (code: string) => ({
  message:
    'Invalid `prisma.$executeRawUnsafe()` invocation:\n\n' +
    `Raw query failed. Code: \`${code}\`. Message: \`FOREIGN KEY constraint failed\``,
})

describe('isHandledTeardownError', () => {
  it('recognises the numeric codes MySQL, SQLite and PostgreSQL report', () => {
    for (const code of ['1451', '1811', '23001', '23503']) {
      expect(isHandledTeardownError(prismaError(code))).toBe(true)
    }
  })

  it('recognises the symbolic codes the SQLite driver adapter reports', () => {
    expect(
      isHandledTeardownError(prismaError('SQLITE_CONSTRAINT_TRIGGER')),
    ).toBe(true)
    expect(
      isHandledTeardownError(prismaError('SQLITE_CONSTRAINT_FOREIGNKEY')),
    ).toBe(true)
  })

  it('does not recognise an unrelated database error', () => {
    expect(isHandledTeardownError(prismaError('SQLITE_BUSY'))).toBe(false)
    expect(isHandledTeardownError(prismaError('42601'))).toBe(false)
  })

  it('does not recognise an error with no code in its message', () => {
    expect(isHandledTeardownError(new Error('connection closed'))).toBe(false)
  })

  it('does not recognise a value that is not an error', () => {
    expect(isHandledTeardownError(undefined)).toBe(false)
    expect(isHandledTeardownError('SQLITE_CONSTRAINT_TRIGGER')).toBe(false)
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
          throw new Error('Raw query failed. Code: `SQLITE_CONSTRAINT_TRIGGER`')
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
      throw new Error(
        'Raw query failed. Code: `SQLITE_CONSTRAINT_TRIGGER`. Message: `abort`',
      )
    })

    await expect(run).rejects.toThrow('SQLITE_CONSTRAINT_TRIGGER')
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
          throw new Error(
            'Raw query failed. Code: `SQLITE_CONSTRAINT_TRIGGER`. Message: `abort`',
          )
        }
      },
    )

    await expect(run).rejects.toThrow('SQLITE_CONSTRAINT_TRIGGER')
    expect(attempts).toBeLessThan(30)
  })

  it('raises an error that is not a foreign-key violation straight away', async () => {
    let attempts = 0

    const run = emptyTablesInWorkingOrder(['A', 'B'], async () => {
      attempts++
      throw new Error('Raw query failed. Code: `SQLITE_BUSY`')
    })

    await expect(run).rejects.toThrow('SQLITE_BUSY')
    expect(attempts).toBe(1)
  })
})
