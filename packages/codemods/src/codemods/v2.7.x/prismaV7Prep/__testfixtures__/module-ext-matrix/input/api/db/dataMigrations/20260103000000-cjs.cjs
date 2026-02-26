import { PrismaClient } from '@prisma/client'

module.exports = async () => new PrismaClient()
