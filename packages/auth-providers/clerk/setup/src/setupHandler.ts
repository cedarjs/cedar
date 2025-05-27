import fs from 'fs'
import path from 'path'

import { standardAuthHandler } from '@cedarjs/cli-helpers'

import type { Args } from './setup'

const { version } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
)

export const handler = async ({ force: forceArg }: Args) => {
  standardAuthHandler({
    basedir: __dirname,
    forceArg,
    authDecoderImport: `import { clerkAuthDecoder as authDecoder } from '@cedarjs/auth-clerk-api'`,
    provider: 'clerk',
    webPackages: [
      '@clerk/clerk-react@^5',
      `@cedarjs/auth-clerk-web@${version}`,
    ],
    apiPackages: [`@cedarjs/auth-clerk-api@${version}`],
    notes: [
      "You'll need to add two env vars to your .env file:",
      '',
      '```title=".env"',
      'CLERK_PUBLISHABLE_KEY="..."',
      'CLERK_SECRET_KEY="..."',
      '```',
      '',
      `You can find their values under "API Keys" on your Clerk app's dashboard.`,
      'Be sure to include `CLERK_PUBLISHABLE_KEY` in the `includeEnvironmentVariables` array in redwood.toml.',
      '',
      '```toml title="redwood.toml"',
      'includeEnvironmentVariables = [',
      '  "CLERK_PUBLISHABLE_KEY"',
      ']',
      '```',
      '',
      'Also see https://redwoodjs.com/docs/auth/clerk for a full walkthrough.',
    ],
  })
}
