import { beforeAll } from 'vitest'

const NETLIFY_DEPLOY_URL = process.env.NETLIFY_DEPLOY_URL

beforeAll(() => {
  if (!NETLIFY_DEPLOY_URL) {
    throw new Error(
      'NETLIFY_DEPLOY_URL environment variable must be set.\n' +
        'Run `npx netlify deploy ...` first and set the URL.\n' +
        'Example: NETLIFY_DEPLOY_URL=https://your-site.netlify.app yarn vitest run',
    )
  }

  if (!NETLIFY_DEPLOY_URL.startsWith('http')) {
    throw new Error(
      `NETLIFY_DEPLOY_URL must be a full URL (starting with http), got: ${NETLIFY_DEPLOY_URL}`,
    )
  }

  process.env.DEPLOY_URL = NETLIFY_DEPLOY_URL.replace(/\/+$/, '')
})
