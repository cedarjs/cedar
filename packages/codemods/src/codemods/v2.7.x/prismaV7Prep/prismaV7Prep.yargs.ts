import task from 'tasuku'
import type { TaskInnerAPI } from 'tasuku'

import prismaV7Prep from './prismaV7Prep'

export const command = 'prisma-v7-prep'
export const description =
  '(v2.7.x) Prepares for Prisma v7 by funneling imports through src/lib/db'

export const handler = () => {
  task('Prisma v7 Prep', async ({ setError }: TaskInnerAPI) => {
    try {
      await prismaV7Prep()
    } catch (e: any) {
      setError('Failed to codemod your project \n' + e?.message)
    }
  })
}
