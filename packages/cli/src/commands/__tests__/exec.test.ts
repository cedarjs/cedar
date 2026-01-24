import path from 'node:path'

import { vi, afterEach, beforeEach, describe, it, expect } from 'vitest'

import '../../lib/mockTelemetry.js'
// @ts-expect-error - No types for .js files
import { handler } from '../execHandler.js'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    scripts: path.join('cedar-app', 'scripts'),
  }),
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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.mocked(console).log.mockRestore()
})

<<<<<<< HEAD
=======
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
})

>>>>>>> c1f5baa5de (fix(cli): Use 'cedar' bin instead of deprecated 'rw' bin (#1027))
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
