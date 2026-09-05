import { describe, expect, it } from 'vitest'

import { addUploadModel, hasModel, UPLOAD_MODEL } from '../schemaPrisma.js'
import {
  addUploadsPlugin,
  hasUploadsPlugin,
  UPLOADS_SERVER_REGISTRATION,
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

${UPLOADS_SERVER_REGISTRATION}
  await server.start()
}

main()
`)
    expect(hasUploadsPlugin(result)).toBe(true)
    expect(addUploadsPlugin(result)).toBe(result)
  })

  it('throws when there is no server.start() to anchor on', () => {
    expect(() => addUploadsPlugin('const nope = 1\n')).toThrow(
      'CEDAR_UPLOADS_ERR_NO_START',
    )
  })
})
