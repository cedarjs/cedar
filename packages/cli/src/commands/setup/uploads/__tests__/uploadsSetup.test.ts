import { describe, expect, it } from 'vitest'

import { addUploadModel, hasModel, UPLOAD_MODEL } from '../schemaPrisma.js'
import {
  addUploadsPlugin,
  detectServerAuth,
  hasUploadsPlugin,
  uploadsServerRegistration,
} from '../serverFile.js'

const SCHEMA = `datasource db {
  provider = "sqlite"
}

model User {
  id String @id
}
`

describe('addUploadModel', () => {
  it('appends the Upload model once', () => {
    const once = addUploadModel(SCHEMA)

    expect(once).toBe(`${SCHEMA.trimEnd()}\n\n${UPLOAD_MODEL}\n`)
    expect(hasModel(once, 'Upload')).toBe(true)
    expect(addUploadModel(once)).toBe(once)
  })

  it('leaves an existing Upload model alone', () => {
    const custom = `${SCHEMA}\nmodel Upload {\n  id String @id\n}\n`

    expect(addUploadModel(custom)).toBe(custom)
  })
})

const SERVER = `import { createServer } from '@cedarjs/api-server'

import { logger } from 'src/lib/logger'

async function main() {
  const server = await createServer({
    logger,
  })

  await server.start()
}

main()
`

describe('detectServerAuth', () => {
  it("recognizes dbAuth's decoder factory", () => {
    expect(
      detectServerAuth(
        "import { createAuthDecoder } from '@cedarjs/auth-dbauth-api'\n",
      ),
    ).toEqual({ decoderPackage: '@cedarjs/auth-dbauth-api', usesFactory: true })
  })

  it('recognizes a ready-made decoder', () => {
    expect(
      detectServerAuth(
        "import { authDecoder } from '@cedarjs/auth-supabase-api'\n",
      ),
    ).toEqual({
      decoderPackage: '@cedarjs/auth-supabase-api',
      usesFactory: false,
    })
  })

  it('returns null without an auth decoder', () => {
    expect(detectServerAuth("import { db } from 'src/lib/db'\n")).toBeNull()
  })
})

describe('addUploadsPlugin', () => {
  it('adds the imports and registers the plugin before the server starts', () => {
    const result = addUploadsPlugin(SERVER)

    expect(result).toBe(`import { createServer } from '@cedarjs/api-server'

import { logger } from 'src/lib/logger'
import { cedarUploadsPlugin } from '@cedarjs/uploads'

import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'

async function main() {
  const server = await createServer({
    logger,
  })

${uploadsServerRegistration(null)}
  await server.start()
}

main()
`)
    expect(hasUploadsPlugin(result)).toBe(true)
    expect(addUploadsPlugin(result)).toBe(result)
  })

  it('wires the authenticator for a dbAuth app', () => {
    const result = addUploadsPlugin(SERVER, {
      auth: { decoderPackage: '@cedarjs/auth-dbauth-api', usesFactory: true },
    })

    expect(result).toContain(
      "import { createAuthDecoder } from '@cedarjs/auth-dbauth-api'",
    )
    expect(result).toContain(
      "import { cedarUploadsPlugin, createUploadAuthenticator } from '@cedarjs/uploads'",
    )
    expect(result).toContain(
      "import { cookieName, getCurrentUser } from 'src/lib/auth'",
    )
    expect(result).toContain(
      'const authDecoder = createAuthDecoder(cookieName)',
    )
    expect(result).toContain(
      'authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),',
    )
  })

  it('wires the authenticator for a provider that exports authDecoder', () => {
    const result = addUploadsPlugin(SERVER, {
      auth: { decoderPackage: '@cedarjs/auth-clerk-api', usesFactory: false },
    })

    expect(result).toContain(
      "import { authDecoder } from '@cedarjs/auth-clerk-api'",
    )
    expect(result).toContain("import { getCurrentUser } from 'src/lib/auth'")
    expect(result).not.toContain('createAuthDecoder')
    expect(result).toContain(
      'authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),',
    )
  })

  it('throws when there is no server.start() to anchor on', () => {
    expect(() => addUploadsPlugin('const nope = 1\n')).toThrow(
      'CEDAR_UPLOADS_ERR_NO_START',
    )
  })
})
