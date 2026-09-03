import { describe, expect, it } from 'vitest'

import { isHandledTeardownError } from '../teardownErrors.js'

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
