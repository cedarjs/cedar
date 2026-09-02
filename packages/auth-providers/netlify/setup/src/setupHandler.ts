import fs from 'node:fs'
import path from 'path'

import { standardAuthHandler } from "@cedarjs/cli-helpers/auth/setupHelpers";

import type { Args } from './setup.js'

const { version } = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../package.json'),
    'utf-8',
  ),
)

export async function handler({ force: forceArg }: Args) {
  standardAuthHandler({
    basedir: import.meta.dirname,
    forceArg,
    provider: 'netlify',
    authDecoderImport: `import { authDecoder } from '@cedarjs/auth-netlify-api'`,
    apiPackages: [`@cedarjs/auth-netlify-api@${version}`],
    webPackages: [
      `@cedarjs/auth-netlify-web@${version}`,
      'netlify-identity-widget@^1',
    ],
    notes: [
      "You'll need to enable Identity on your Netlify site and configure the API endpoint locally.",
      'See https://cedarjs.com/docs/auth/netlify for a full walkthrough.',
    ],
  })
}
