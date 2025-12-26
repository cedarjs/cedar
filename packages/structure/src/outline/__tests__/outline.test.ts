import path from 'node:path'

import { describe, it, beforeAll, afterAll } from 'vitest'

import { DefaultHost } from '../../hosts'
import { RWProject } from '../../model'
import { getOutline } from '../outline'
import { outlineToJSON } from '../types'

let originalEnv: NodeJS.ProcessEnv

beforeAll(async () => {
  originalEnv = process.env
  process.env.DATABASE_URL = 'file:./dev.db'
})

afterAll(() => {
  process.env = originalEnv
})

describe('Cedar Project Outline', () => {
  it('can be built for example-todo-main', async () => {
    const projectRoot = getFixtureDir('example-todo-main')
    const project = new RWProject({ projectRoot, host: new DefaultHost() })
    const outline = getOutline(project)
    // This needs the Prisma schema, so it'll call getSchemaPath, which will
    // import the `prisma.config.{js,ts}` file. In that file we call
    // `env(DATABASE_URL)`, and if DATABASE_URL is not set, it will throw an
    // error. That's why we set it in the beforeAll hook.
    await outlineToJSON(outline)
  })
})

function getFixtureDir(name: string) {
  return path.resolve(__dirname, `../../../../../__fixtures__/${name}`)
}
