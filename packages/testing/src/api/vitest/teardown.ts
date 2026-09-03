/**
 * The driver errors scenario teardown recovers from by emptying that table
 * later: a row still referenced by another table, whether the constraint
 * rejects the delete outright or restricts it.
 *
 * Prisma 7 talks to every database through a driver adapter, and adapters
 * report errors with a `kind` from a vocabulary they all share, so the
 * database's own error codes never have to be read here.
 */
const RETRYABLE_ERROR_KINDS = [
  'ForeignKeyConstraintViolation',
  'RestrictViolation',
]

/**
 * Reads `key` off a value that may not be an object, so a driver error can be
 * walked without assuming any part of its shape exists.
 */
function property(value: unknown, key: string): unknown {
  // The `typeof` check above the index makes this safe: only an object is
  // ever indexed, and a missing key reads as `undefined`.
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/**
 * Whether `e` is a constraint violation that scenario teardown recovers from
 * by emptying the table later, rather than an error worth raising.
 */
export function isHandledTeardownError(e: unknown): boolean {
  const cause = property(
    property(property(e, 'meta'), 'driverAdapterError'),
    'cause',
  )
  const kind = property(cause, 'kind')

  return typeof kind === 'string' && RETRYABLE_ERROR_KINDS.includes(kind)
}

/**
 * Empties every table in `order`, deferring a table to the end of the order
 * when a foreign key says another table has to be emptied first, and
 * returning the order that worked so the next run can start with it.
 *
 * A table that cannot be emptied in any order (a trigger that aborts the
 * delete, or a foreign key no ordering satisfies) would otherwise be deferred
 * forever, since deferring appends to the order being walked. Deferring every
 * table still waiting without emptying one means no order works, so the
 * driver's error is raised instead.
 */
export async function emptyTablesInWorkingOrder(
  order: string[],
  emptyTable: (modelName: string) => Promise<unknown>,
): Promise<string[]> {
  const remaining: (string | null)[] = [...order]
  let pendingCount = remaining.length
  let deferralsSinceLastEmptied = 0

  for (const modelName of remaining) {
    if (modelName === null) {
      continue
    }

    try {
      await emptyTable(modelName)
      pendingCount--
      deferralsSinceLastEmptied = 0
    } catch (e) {
      console.error('teardown error\n', e)

      if (
        !isHandledTeardownError(e) ||
        deferralsSinceLastEmptied >= pendingCount
      ) {
        throw e
      }

      deferralsSinceLastEmptied++
      remaining[remaining.indexOf(modelName)] = null
      remaining.push(modelName)
    }
  }

  return remaining.filter((name) => name !== null)
}
