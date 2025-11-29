import { $ } from 'zx'

export default async function setup() {
  $.verbose = true
  console.log('[setup] Setting up unit test prisma db....')
  await $`npx prisma db push --accept-data-loss --config ./src/__tests__/prisma.config.ts`
  console.log('[setup] Done! \n')
}
