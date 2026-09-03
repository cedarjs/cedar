import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

import { logger } from './logger.js'

const prismaClient = new PrismaClient()

export const db = prismaClient
