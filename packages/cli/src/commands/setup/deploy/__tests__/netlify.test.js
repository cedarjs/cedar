process.env.RWJS_CWD = '/cedar-app'
vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return {
    ...memfs.fs,
    default: memfs.fs,
  }
})
vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getConfigPath: vi.fn(() => '/cedar-app/cedar.toml'),
  }
})

import fs from 'node:fs'
import path from 'path'

import { vol } from 'memfs'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock telemetry and other things
import '../../../../lib/test'

import { getPaths } from '../../../../lib/index.js'
import { updateApiURLTask } from '../helpers/index.js'

vi.mock('../../../../lib', async (importOriginal) => {
  const { printSetupNotes } = await importOriginal()

  return {
    printSetupNotes,
    getPaths: vi.fn(() => {
      return {
        base: '/cedar-app',
      }
    }),
    getConfig: () => ({
      web: {
        port: 8910,
      },
    }),
    writeFilesTask: (fileNameToContentMap) => {
      const keys = Object.keys(fileNameToContentMap)
      expect(keys.length).toBe(1)
      // Need to escape path.sep on Windows, otherwise the backslash (that
      // path.sep is on Windows) together with the 'n' in "netlify" will be
      // interpreted as a new-line. And need to use double backslashes, so
      // that one "survives" into the regexp
      expect(keys[0]).toMatch(new RegExp(`\\${path.sep}netlify.toml$`))
      for (const key of keys) {
        fs.writeFileSync(key, fileNameToContentMap[key])
      }
    },
  }
})

const mockConfigPath = '/cedar-app/cedar.toml'

beforeEach(() => {
  process.env.RWJS_CWD = '/cedar-app'

  vi.mocked(getPaths).mockReturnValue({
    base: '/cedar-app',
  })

  vol.fromJSON({
    [mockConfigPath]: `[web]
  title = "Cedar App"
  port = 8910
  apiUrl = "/.redwood/functions" # you can customize graphql and dbAuth urls individually too: see https://cedarjs.com/docs/app-configuration-cedar-toml#api-paths
  includeEnvironmentVariables = [
    # Add any ENV vars that should be available to the web side to this array
    # See https://cedarjs.com/docs/environment-variables#web
  ]
[api]
  port = 8911
[browser]
  open = true
`,
  })
})

describe('netlify', () => {
  it('should call the handler without error', async () => {
    const netlify = await import('../providers/netlifyHandler')

    let error = undefined
    try {
      await netlify.handler({ force: true })
    } catch (err) {
      error = err
    }
    expect(error).toBeUndefined()
    const filesystem = vol.toJSON()
    const netlifyTomlPath = Object.keys(filesystem).find((path) =>
      path.endsWith('netlify.toml'),
    )
    expect(netlifyTomlPath).toBeDefined()
    expect(filesystem[netlifyTomlPath]).toMatchSnapshot()
  })

  it('Should update cedar.toml apiUrl', () => {
    updateApiURLTask('/.netlify/functions').task()

    expect(fs.readFileSync(mockConfigPath, 'utf8')).toMatch(
      /apiUrl = "\/.netlify\/functions"/,
    )
  })

  it('should add netlify.toml', async () => {
    const netlify = await import('../providers/netlify')
    await netlify.handler({ force: true })

    const filesystem = vol.toJSON()
    const netlifyTomlPath = Object.keys(filesystem).find((path) =>
      path.endsWith('netlify.toml'),
    )
    expect(netlifyTomlPath).toBeDefined()
    expect(filesystem[netlifyTomlPath]).toMatchSnapshot()
  })
})
