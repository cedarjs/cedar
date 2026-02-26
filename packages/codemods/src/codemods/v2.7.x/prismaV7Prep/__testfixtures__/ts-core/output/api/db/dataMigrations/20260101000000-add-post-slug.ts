import type { PrismaClient } from "src/lib/db"

export default async ({ db }: { db: PrismaClient }) => {
  await db.$executeRaw`SELECT 1`
}
