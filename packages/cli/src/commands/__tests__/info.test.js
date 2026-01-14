// import '../../lib/test'
import '../../lib/mockTelemetry'

import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest'

import { handler } from '../info.js'

vi.mock('envinfo', () => ({ default: { run: () => '' } }))
vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({}),
  getConfigPath: () => 'cedar.toml',
}))

const mockCedarToml = {
  fileContents: '',
}

// Before rw tests run, api/ and web/ `jest.config.js` is confirmed via existsSync()
vi.mock('node:fs', async () => ({
  default: {
    readFileSync: () => {
      return mockCedarToml.fileContents
    },
  },
}))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.mocked(console).log.mockRestore()
})

describe('yarn cedar info', () => {
  describe('cedar.toml', () => {
    it('is included in the output', async () => {
      mockCedarToml.fileContents = 'title = "Hello World"'

      await handler()

      expect(vi.mocked(console).log).toHaveBeenCalledWith(
        [
          // There should be nothing before 'cedar.toml:' in the output
          // because we mock envinfo
          '  cedar.toml:',
          '    title = "Hello World"',
        ].join('\n'),
      )
    })

    it('has blank lines removed', async () => {
      mockCedarToml.fileContents = `
[web]

  title = "Hello World"
`

      await handler()

      expect(vi.mocked(console).log).toHaveBeenCalledWith(
        [
          // The important part is that there is no blank line after [web]
          '  cedar.toml:',
          '    [web]',
          '      title = "Hello World"',
        ].join('\n'),
      )
    })

    it('has start-of-line-comment lines removed', async () => {
      mockCedarToml.fileContents = `
# This is a start-of-line-comment that we want to remove.
# And so is this
[web]
  # Used for the <title> tag (this comment should be kept)
  title = "Hello World"

# Another comment that should be removed
`

      await handler()

      expect(vi.mocked(console).log).toHaveBeenCalledWith(
        [
          '  cedar.toml:',
          '    [web]',
          '      # Used for the <title> tag (this comment should be kept)',
          '      title = "Hello World"',
        ].join('\n'),
      )
    })

    // TODO: Actually want to strip this comment, but it's too much work to do
    // without a proper parser and pretty-printer. (We've tried finding one,
    // but couldn't find anything. So we'll have to write our own at some
    // point)
    it('keeps end-of-line comments', async () => {
      mockCedarToml.fileContents = `
[web]
  title = "Hello World" # Used for the <title> tag
  apiUrl = "/.redwood/functions" # You can customize graphql and dbauth urls individually too: see https://cedarjs.com/docs/app-configuration-redwood-toml#api-paths
`

      await handler()

      expect(vi.mocked(console).log).toHaveBeenCalledWith(
        [
          '  cedar.toml:',
          '    [web]',
          '      title = "Hello World" # Used for the <title> tag',
          // This next line is a bit more tricky because it has a # to make it
          // a comment, but then also a # in the URL.
          '      apiUrl = "/.redwood/functions" # You can customize graphql and dbauth urls individually too: see https://cedarjs.com/docs/app-configuration-redwood-toml#api-paths',
        ].join('\n'),
      )
    })
  })
})
