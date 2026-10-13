import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import type { UploadDatabase, UploadVariantDatabase } from '../../types.js'
import { PrismaClient } from '../prisma-client/client.js'

const adapter = new PrismaBetterSqlite3({
  url: 'file:src/__tests__/for_unit_test.db',
})

export const prisma = new PrismaClient({ adapter })

// Assigning the generated client to the package's structural interface is
// itself the type test: if the interface drifts from what Prisma generates,
// this line stops compiling.
export const db: UploadDatabase = prisma

// The same check for the variant columns (`sourceId`, `variant`)
export const variantDb: UploadDatabase & UploadVariantDatabase = prisma

export async function resetTestDb() {
  // Variants reference their source with `onDelete: Restrict`, so they go
  // first
  await prisma.upload.deleteMany({ where: { sourceId: { not: null } } })
  await prisma.upload.deleteMany()
}
