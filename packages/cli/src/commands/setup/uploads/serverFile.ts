/**
 * Plain-text editing of `api/src/server.ts` for `cedar setup uploads`: adds
 * the imports the upload plugin needs and registers it right before the
 * server starts. Throws `CEDAR_UPLOADS_ERR_NO_START` when the file has no
 * `await server.start()` line to anchor on, and returns the source unchanged
 * when the plugin is already registered.
 */

export const UPLOADS_SERVER_IMPORTS = [
  "import { cedarUploadsPlugin } from '@cedarjs/uploads'",
  '',
  "import { db } from 'src/lib/db'",
  "import { targets } from 'src/lib/uploads'",
]

export const UPLOADS_SERVER_REGISTRATION = `  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    // To bind upload tokens to the logged-in user, pass an authenticator
    // built from your auth decoder and getCurrentUser:
    //
    //   authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })
`

const START_LINE = /^([ \t]*)await server\.start\(\)/m

export function hasUploadsPlugin(source: string): boolean {
  return source.includes('cedarUploadsPlugin')
}

export function addUploadsPlugin(source: string): string {
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
    ...UPLOADS_SERVER_IMPORTS,
    ...lines.slice(lastImport + 1),
  ].join('\n')

  return withImports.replace(
    START_LINE,
    (line) => `${UPLOADS_SERVER_REGISTRATION}\n${line}`,
  )
}
