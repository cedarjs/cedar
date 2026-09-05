/**
 * Plain-text editing of `api/src/server.ts` for `cedar setup uploads`: adds
 * the imports the upload plugin needs and registers it right before the
 * server starts. Throws `CEDAR_UPLOADS_ERR_NO_START` when the file has no
 * `await server.start()` line to anchor on, and returns the source unchanged
 * when the plugin is already registered.
 */

/**
 * How the app builds its auth decoder, detected from
 * `api/src/functions/graphql`. dbAuth exposes a `createAuthDecoder(cookieName)`
 * factory; every other provider exports a ready-made `authDecoder`.
 */
export interface UploadsServerAuth {
  decoderPackage: string
  usesFactory: boolean
}

const START_LINE = /^([ \t]*)await server\.start\(\)/m

const FACTORY_IMPORT =
  /import\s*\{[^}]*\bcreateAuthDecoder\b[^}]*\}\s*from\s*['"](@cedarjs\/auth-[a-z0-9-]+-api)['"]/
const DECODER_IMPORT =
  /import\s*\{[^}]*\bauthDecoder\b[^}]*\}\s*from\s*['"](@cedarjs\/auth-[a-z0-9-]+-api)['"]/

/**
 * Detects the auth decoder the app's GraphQL handler uses, so the upload
 * plugin can be registered with the same identity pipeline. Returns `null`
 * when the handler does not import one.
 */
export function detectServerAuth(
  graphqlSource: string,
): UploadsServerAuth | null {
  const factory = FACTORY_IMPORT.exec(graphqlSource)

  if (factory) {
    return { decoderPackage: factory[1], usesFactory: true }
  }

  const decoder = DECODER_IMPORT.exec(graphqlSource)

  if (decoder) {
    return { decoderPackage: decoder[1], usesFactory: false }
  }

  return null
}

export function uploadsServerImports(auth: UploadsServerAuth | null) {
  if (!auth) {
    return [
      "import { cedarUploadsPlugin } from '@cedarjs/uploads'",
      '',
      "import { db } from 'src/lib/db'",
      "import { targets } from 'src/lib/uploads'",
    ]
  }

  return [
    auth.usesFactory
      ? `import { createAuthDecoder } from '${auth.decoderPackage}'`
      : `import { authDecoder } from '${auth.decoderPackage}'`,
    "import { cedarUploadsPlugin, createUploadAuthenticator } from '@cedarjs/uploads'",
    '',
    auth.usesFactory
      ? "import { cookieName, getCurrentUser } from 'src/lib/auth'"
      : "import { getCurrentUser } from 'src/lib/auth'",
    "import { db } from 'src/lib/db'",
    "import { targets } from 'src/lib/uploads'",
  ]
}

export function uploadsServerRegistration(auth: UploadsServerAuth | null) {
  if (!auth) {
    return `  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    // Once the app has auth, bind upload tokens to the logged-in user:
    //
    //   authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })
`
  }

  const decoder = auth.usesFactory
    ? '  const authDecoder = createAuthDecoder(cookieName)\n\n'
    : ''

  return `${decoder}  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    // Binds upload tokens to the logged-in user through the same auth
    // pipeline the GraphQL server uses
    authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })
`
}

export function hasUploadsPlugin(source: string): boolean {
  return source.includes('cedarUploadsPlugin')
}

export function addUploadsPlugin(
  source: string,
  { auth = null }: { auth?: UploadsServerAuth | null } = {},
): string {
  if (hasUploadsPlugin(source)) {
    return source
  }

  const start = START_LINE.exec(source)

  if (!start) {
    throw new Error('CEDAR_UPLOADS_ERR_NO_START')
  }

  const lines = source.split('\n')
  let lastImport = -1

  for (const [index, line] of lines.entries()) {
    if (/^import\s/.test(line)) {
      lastImport = index
    }
  }

  const withImports = [
    ...lines.slice(0, lastImport + 1),
    ...uploadsServerImports(auth),
    ...lines.slice(lastImport + 1),
  ].join('\n')

  return withImports.replace(
    START_LINE,
    (line) => `${uploadsServerRegistration(auth)}\n${line}`,
  )
}
