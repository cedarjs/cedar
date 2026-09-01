// Minimal mock Prisma accessor for tests, following the pattern used in
// `packages/auth-providers/dbAuth/api/src/__tests__/DbAuthHandler.test.js`.
// Unlike that helper, `findMany`/`deleteMany` here filter by every key in
// `where` (not just the first), since `IdentityModel` looks records up by
// the `(provider, providerUserId)`/`(userId, provider)` compound keys.

type Where = Record<string, unknown>

function matches(record: Record<string, unknown>, where: Where | undefined) {
  return Object.entries(where ?? {}).every(
    ([key, value]) => record[key] === value,
  )
}

let nextId = 1

export class TableMock {
  records: Record<string, any>[] = []

  create({ data }: { data: Record<string, any> }) {
    const record = { id: nextId++, ...data }
    this.records.push(record)
    return JSON.parse(JSON.stringify(record))
  }

  findFirst({ where }: { where?: Where } = {}) {
    const record = this.records.find((r) => matches(r, where))
    return record ? JSON.parse(JSON.stringify(record)) : null
  }

  findMany({ where }: { where?: Where } = {}) {
    return this.records
      .filter((r) => matches(r, where))
      .map((r) => JSON.parse(JSON.stringify(r)))
  }

  deleteMany({ where }: { where?: Where } = {}) {
    const before = this.records.length
    this.records = this.records.filter((r) => !matches(r, where))
    return { count: before - this.records.length }
  }
}

export class DbMock {
  [accessor: string]: TableMock

  constructor(accessors: string[]) {
    for (const accessor of accessors) {
      this[accessor] = new TableMock()
    }
  }
}
