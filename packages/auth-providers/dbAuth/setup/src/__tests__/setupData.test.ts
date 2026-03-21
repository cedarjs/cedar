import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest'

import { createUserModelTask } from '../setupData'

const CEDAR_CWD = process.env.CEDAR_CWD
const DATABASE_URL = process.env.DATABASE_URL

const { cedarProjectPath, prismaConfigPath, libPath, functionsPath } =
  vi.hoisted(() => {
    const cedarProjectPath = '../../../../__fixtures__/kitchen-sink-project'

    return {
      cedarProjectPath,
      prismaConfigPath: cedarProjectPath + '/api/prisma.config.cjs',
      libPath: cedarProjectPath + '/api/src/lib',
      functionsPath: cedarProjectPath + '/api/src/functions',
    }
  })

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    getGraphqlPath: () => {
      return cedarProjectPath + '/api/src/functions/graphql.ts'
    },
    getPaths: () => ({
      base: cedarProjectPath,
      api: {
        lib: libPath,
        functions: functionsPath,
        prismaConfig: prismaConfigPath,
      },
    }),
    colors: {
      error: (str: string) => str,
      warning: (str: string) => str,
      green: (str: string) => str,
      info: (str: string) => str,
      bold: (str: string) => str,
      underline: (str: string) => str,
    },
    addEnvVarTask: () => {},
  }
})

beforeAll(() => {
  process.env.CEDAR_CWD = cedarProjectPath
  process.env.DATABASE_URL = 'file:./db/dev.db'
})

afterAll(() => {
  process.env.CEDAR_CWD = CEDAR_CWD
  process.env.DATABASE_URL = DATABASE_URL
})

describe('setupData createUserModelTask (kitchen-sink-project)', () => {
  it('throws an error if a User model already exists', async () => {
    await expect(() => {
      return createUserModelTask.task({
        force: false,
        setupMode: 'UNKNOWN',
        provider: 'dbAuth',
      })
    }).rejects.toThrow('User model already exists')
  })
})
