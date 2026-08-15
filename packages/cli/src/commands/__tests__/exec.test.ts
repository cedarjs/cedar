import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest'

import { runScriptFunction } from '../../lib/exec.js'
import '../../lib/mockTelemetry'
import { handler } from '../execHandler.js'

vi.mock('@cedarjs/babel-config', () => ({
  getWebSideDefaultBabelConfig: () => ({
    presets: [],
    plugins: [],
  }),
  registerApiSideBabelHook: () => {},
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: { base: '', src: '' },
    web: { base: '', src: '' },
    scripts: path.join('cedar-app', 'scripts'),
  }),
  getConfig: () => ({ experimental: { streamingSsr: { enabled: false } } }),
  resolveFile: (path: string) => path,
}))

vi.mock('@cedarjs/internal/dist/files', () => ({
  findScripts: () => {
    const scriptsPath = path.join('cedar-app', 'scripts')

    return [
      path.join(scriptsPath, 'one', 'two', 'myNestedScript.ts'),
      path.join(scriptsPath, 'conflicting.js'),
      path.join(scriptsPath, 'conflicting.ts'),
      path.join(scriptsPath, 'normalScript.ts'),
      path.join(scriptsPath, 'secondNormalScript.ts'),
    ]
  },
}))

vi.mock('../../lib/exec', () => ({
  runScriptFunction: vi.fn(),
}))

vi.mock('node:fs', () => ({ ...memfs, default: { ...memfs } }))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.mocked(console).log.mockRestore()
})

describe('yarn cedar exec', () => {
  it('passes args on to the script', async () => {
    vol.fromJSON({
      'redwood.toml': '# redwood.toml',
      [path.join('cedar-app', 'scripts', 'normalScript.ts')]: '// script',
    })

    // Running:
    // `yarn cedar exec normalScript positional1 --no-prisma positional2 --arg1=foo --arg2 bar`
    const args = {
      _: ['exec', 'positional1', 'positional2'],
      prisma: false,
      arg1: 'foo',
      arg2: 'bar',
      list: false,
      l: false,
      silent: false,
      s: false,
      $0: 'cedar',
      name: 'normalScript',
    }
    await handler(args)
    expect(runScriptFunction).toHaveBeenCalledWith({
      args: {
        args: {
          _: ['positional1', 'positional2'],
          arg1: 'foo',
          arg2: 'bar',
        },
      },
      functionName: 'default',
      path: path.join('cedar-app', 'scripts', 'normalScript.ts'),
    })
  })

  it('re-parses args placed after a literal `--` instead of dropping them', async () => {
    vol.fromJSON({
      'redwood.toml': '# redwood.toml',
      [path.join('cedar-app', 'scripts', 'normalScript.ts')]: '// script',
    })

    // Running:
    // `yarn cedar exec normalScript -- positional1 --force --env=prod`
    //
    // yargs stops parsing flags at `--`, so everything after it lands in
    // `_` as literal, unparsed strings instead of being split out into
    // `force`/`env`.
    const args = {
      _: ['exec', 'positional1', '--force', '--env=prod'],
      prisma: false,
      list: false,
      l: false,
      silent: false,
      s: false,
      $0: 'cedar',
      name: 'normalScript',
    }
    await handler(args)
    expect(runScriptFunction).toHaveBeenCalledWith({
      args: {
        args: {
          _: ['positional1'],
          force: true,
          env: 'prod',
        },
      },
      functionName: 'default',
      path: path.join('cedar-app', 'scripts', 'normalScript.ts'),
    })
  })

  it('forwards a reserved-looking flag name (e.g. `--silent`) placed after `--` instead of stripping it', async () => {
    vol.fromJSON({
      'redwood.toml': '# redwood.toml',
      [path.join('cedar-app', 'scripts', 'normalScript.ts')]: '// script',
    })

    // Running:
    // `yarn cedar exec normalScript -- --silent`
    //
    // `--silent`, `-s` and `-l` are also cedar's own reserved exec flags, and
    // are stripped from `scriptArgs` before being passed to the script. But
    // if the *user's* script defines its own `--silent` flag and the user
    // passes it after a literal `--`, it should reach the script rather than
    // being silently deleted by that reserved-flag cleanup.
    const args = {
      _: ['exec', '--silent'],
      prisma: false,
      list: false,
      l: false,
      silent: false,
      s: false,
      $0: 'cedar',
      name: 'normalScript',
    }
    await handler(args)
    expect(runScriptFunction).toHaveBeenCalledWith({
      args: {
        args: {
          _: [],
          silent: true,
        },
      },
      functionName: 'default',
      path: path.join('cedar-app', 'scripts', 'normalScript.ts'),
    })
  })
})

describe('yarn cedar exec --list', () => {
  it('includes nested scripts', async () => {
    await handler({ list: true })
    const scriptPath = path
      .join('one', 'two', 'myNestedScript')
      // Handle Windows path separators
      .replaceAll('\\', '\\\\')
    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('\\b' + scriptPath + '\\b')),
    )
  })

  it("does not include the file extension if there's no ambiguity", async () => {
    await handler({ list: true })
    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('\\bnormalScript\\b')),
    )
    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('\\bsecondNormalScript\\b')),
    )
  })

  it('includes the file extension if there could be ambiguity', async () => {
    await handler({ list: true })
    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('\\bconflicting.js\\b')),
    )
    expect(vi.mocked(console).log).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp('\\bconflicting.ts\\b')),
    )
  })
})
