// import '../../lib/test'
import '../../lib/mockTelemetry'

import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest'

import { handler } from '../info.ts'

const mockSystemInfo = vi.hoisted(() => {
  const state: {
    envinfoOutput: string
    osName: string
    shellPath: string | undefined
    packageManager: { name: string; version: string } | undefined
  } = {
    envinfoOutput: '',
    osName: 'macOS 15.2',
    shellPath: undefined,
    packageManager: undefined,
  }

  return state
})

vi.mock('envinfo', () => ({
  default: { run: async () => mockSystemInfo.envinfoOutput },
}))
vi.mock('@cedarjs/telemetry/systemInfo', () => ({
  getOsName: () => mockSystemInfo.osName,
  getShellPath: () => mockSystemInfo.shellPath,
  getPackageManager: () => mockSystemInfo.packageManager,
}))
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
  mockSystemInfo.envinfoOutput = ''
  mockSystemInfo.osName = 'macOS 15.2'
  mockSystemInfo.shellPath = undefined
  mockSystemInfo.packageManager = undefined
})

/** The part of the output from `cedar.toml:` on */
function loggedTomlSection() {
  const output = String(vi.mocked(console).log.mock.calls[0]?.[0])

  return output.slice(output.indexOf('  cedar.toml:'))
}

describe('yarn cedar info', () => {
  it('prints system info in the same format as envinfo', async () => {
    mockCedarToml.fileContents = 'title = "Hello World"'
    mockSystemInfo.shellPath = '/bin/zsh'
    mockSystemInfo.packageManager = { name: 'yarn', version: '4.14.1' }
    mockSystemInfo.envinfoOutput = '\n  Browsers:\n    Safari: 18.2\n'

    await handler()

    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      [
        '',
        '  System:',
        '    OS: macOS 15.2',
        '    Shell: /bin/zsh',
        '  Binaries:',
        `    Node: ${process.versions.node} - ${process.execPath}`,
        '    Yarn: 4.14.1',
        '  Browsers:',
        '    Safari: 18.2',
        '  cedar.toml:',
        '    title = "Hello World"',
      ].join('\n'),
    )
  })

  it('leaves out what is not known', async () => {
    mockCedarToml.fileContents = 'title = "Hello World"'

    await handler()

    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      [
        '',
        '  System:',
        '    OS: macOS 15.2',
        '  Binaries:',
        `    Node: ${process.versions.node} - ${process.execPath}`,
        '  cedar.toml:',
        '    title = "Hello World"',
      ].join('\n'),
    )
  })

  describe('cedar.toml', () => {
    it('is included in the output', async () => {
      mockCedarToml.fileContents = 'title = "Hello World"'

      await handler()

      expect(loggedTomlSection()).toEqual(
        ['  cedar.toml:', '    title = "Hello World"'].join('\n'),
      )
    })

    it('has blank lines removed', async () => {
      mockCedarToml.fileContents = `
[web]

  title = "Hello World"
`

      await handler()

      expect(loggedTomlSection()).toEqual(
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

      expect(loggedTomlSection()).toEqual(
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
  apiUrl = "/.api/functions" # You can customize graphql and dbauth urls individually too: see https://cedarjs.com/docs/app-configuration-redwood-toml#api-paths
`

      await handler()

      expect(loggedTomlSection()).toEqual(
        [
          '  cedar.toml:',
          '    [web]',
          '      title = "Hello World" # Used for the <title> tag',
          // This next line is a bit more tricky because it has a # to make it
          // a comment, but then also a # in the URL.
          '      apiUrl = "/.api/functions" # You can customize graphql and dbauth urls individually too: see https://cedarjs.com/docs/app-configuration-redwood-toml#api-paths',
        ].join('\n'),
      )
    })
  })
})
