import type { PrismaClient } from '@prisma/client'

export default async ({ db }: { db: PrismaClient }) => {
  await db.$executeRaw`SELECT 1`
}
