import { vol, fs as memfs } from 'memfs'
import { vi, expect, describe, it } from 'vitest'
import yargs from 'yargs'

import { getPaths } from '@cedarjs/project-config'

import * as upCommand from '../commands/up'
import { handler as dataMigrateUpHandler } from '../commands/upHandler.js'

vi.mock('fs', async () => ({ ...memfs, default: memfs }))
vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('../commands/upHandler.js', () => ({
  handler: vi.fn(),
}))

describe('up', () => {
  it('exports `command`, `description`, `builder`, and `handler`', () => {
    expect(upCommand).toHaveProperty('command', 'up')
    expect(upCommand).toHaveProperty(
      'description',
      'Run any outstanding Data Migrations against the database',
    )
    expect(upCommand).toHaveProperty('builder')
    expect(upCommand).toHaveProperty('handler')
  })

  it('`builder` configures two options with defaults', () => {
    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        'package.json': '{}',
        api: {
          dist: {},
        },
      },
      '/redwood-app',
    )

    process.env.RWJS_CWD = '/redwood-app'

    const { argv } = upCommand.builder(yargs())

    expect(argv).toHaveProperty('import-db-client-from-dist', false)
    expect(argv).toHaveProperty('dist-path', getPaths().api.dist)
  })

  it('`handler` proxies to `./upHandler.js`', async () => {
    await upCommand.handler({
      importDbClientFromDist: false,
      distPath: '',
    })
    expect(dataMigrateUpHandler).toHaveBeenCalled()
  })
})
