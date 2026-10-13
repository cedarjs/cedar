import { $ } from 'zx'

const config = './src/__tests__/prisma.config.ts'
const schema = './src/__tests__/unit-test-schema.prisma'

export default async function setup() {
  $.verbose = true
  console.log('[setup] Generating Prisma Client....')
  await $`npx prisma generate --config ${config}`
  // The SQL that creates the schema's tables. Each test file that needs a
  // database creates its own from it (see `createTestDb()`), so test files
  // can run in parallel without sharing a database
  console.log('[setup] Writing the unit test schema SQL....')
  await $`npx prisma migrate diff --config ${config} --from-empty --to-schema ${schema} --script -o ./src/__tests__/unit-test-schema.sql`
  console.log('[setup] Done! \n')
}
