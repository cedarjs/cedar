import { beforeAll } from 'vitest'

const VERCEL_DEPLOY_URL = process.env.VERCEL_DEPLOY_URL

beforeAll(() => {
  if (!VERCEL_DEPLOY_URL) {
    throw new Error(
      'VERCEL_DEPLOY_URL environment variable must be set.\n' +
        'Run `npx vercel deploy ...` first and set the URL.\n' +
        'Example: VERCEL_DEPLOY_URL=https://your-site.vercel.app yarn vitest run',
    )
  }

  if (!VERCEL_DEPLOY_URL.startsWith('http')) {
    throw new Error(
      `VERCEL_DEPLOY_URL must be a full URL (starting with http), got: ${VERCEL_DEPLOY_URL}`,
    )
  }

  process.env.DEPLOY_URL = VERCEL_DEPLOY_URL.replace(/\/+$/, '')
})
