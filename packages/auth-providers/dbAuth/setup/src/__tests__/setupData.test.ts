import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest'

import { createUserModelTask } from '../setupData'

const RWJS_CWD = process.env.RWJS_CWD
const DATABASE_URL = process.env.DATABASE_URL

const { redwoodProjectPath, prismaConfigPath, libPath, functionsPath } =
  vi.hoisted(() => {
    const redwoodProjectPath = '../../../../__fixtures__/test-project'

    return {
      redwoodProjectPath,
      prismaConfigPath: redwoodProjectPath + '/api/prisma.config.cjs',
      libPath: redwoodProjectPath + '/api/src/lib',
      functionsPath: redwoodProjectPath + '/api/src/functions',
    }
  })

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    getGraphqlPath: () => {
      return redwoodProjectPath + '/api/src/functions/graphql.ts'
    },
    getPaths: () => ({
      base: redwoodProjectPath,
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
  process.env.RWJS_CWD = redwoodProjectPath
  process.env.DATABASE_URL = 'file:./dev.db'
})

afterAll(() => {
  process.env.RWJS_CWD = RWJS_CWD
  process.env.DATABASE_URL = DATABASE_URL
})

describe('setupData createUserModelTask (test-project)', () => {
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
