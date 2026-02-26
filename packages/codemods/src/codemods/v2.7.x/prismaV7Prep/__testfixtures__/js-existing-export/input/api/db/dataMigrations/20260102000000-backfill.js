import { PrismaClient } from '@prisma/client'

export default async () => {
  return new PrismaClient()
}
