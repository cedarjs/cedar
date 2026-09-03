/**
 * Foreign-key violations a `DELETE FROM <table>` raises when scenario
 * teardown empties the tables in an order a relation doesn't allow. Hitting
 * one means that table is emptied later instead, so recognising them is what
 * lets teardown settle on a working order.
 *
 * Codes are strings because drivers report them either numerically or
 * symbolically:
 *
 * - `1451`: MySQL FK constraint violation on DELETE
 * - `1811`: SQLite FK constraint violation on DELETE
 * - `23001`: PostgreSQL RESTRICT violation. PG 18+ strictly enforces this on
 *   DELETE
 * - `23503`: PostgreSQL FK constraint violation on DELETE
 * - `SQLITE_CONSTRAINT_FOREIGNKEY`, `SQLITE_CONSTRAINT_TRIGGER`: the same
 *   SQLite violation as `1811`, as the driver adapter names it
 */
const HANDLED_ERROR_CODES = [
  '1451',
  '1811',
  '23001',
  '23503',
  'SQLITE_CONSTRAINT_FOREIGNKEY',
  'SQLITE_CONSTRAINT_TRIGGER',
]

function isErrorWithMessage(e: unknown): e is { message: string } {
  return (
    !!e &&
    typeof e === 'object' &&
    'message' in e &&
    typeof e.message === 'string'
  )
}

/**
 * Whether `e` is a foreign-key violation that scenario teardown recovers from
 * by emptying the table later. Prisma reports the driver's code in the error
 * message as ``Code: `<code>` ``.
 */
export function isHandledTeardownError(e: unknown): boolean {
  if (!isErrorWithMessage(e)) {
    return false
  }

  const match = e.message.match(/Code: `([^`]+)`/)

  return !!match && HANDLED_ERROR_CODES.includes(match[1])
}
