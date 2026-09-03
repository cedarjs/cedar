import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

import { logger } from './logger.js'

import { createTenancyExtension } from '@cedarjs/tenancy'

const prismaClient = new PrismaClient()

export const db = prismaClient.$extends(
  createTenancyExtension<typeof prismaClient>({
    tenantField: 'accountId',

    models: {
      allExcept: ['user', 'organization', 'membership'],
    },
  }),
)
