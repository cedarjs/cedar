import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCommands = vi.hoisted(() => {
  const output: Record<string, string> = {}
  const stderr: Record<string, string> = {}

  return { output, stderr }
})

vi.mock('node:child_process', () => ({
  exec: (
    command: string,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const output = mockCommands.output[command]

    if (output === undefined) {
      callback(new Error(`not found: ${command}`), '', '')
    } else {
      callback(null, output, '')
    }
  },
  execFile: (
    file: string,
    args: string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const command = [file, ...args].join(' ')
    const output = mockCommands.output[command]

    if (output === undefined) {
      callback(new Error(`not found: ${command}`), '', '')
    } else {
      callback(null, output, mockCommands.stderr[command] ?? '')
    }
  },
}))

const { getNodeInfo, getOsName, getShellInfo, getVSCodeInfo, getYarnInfo } =
  await import('../systemInfo.js')

const originalPlatform = process.platform

/**
 * `which` builds paths with the `path` module of the OS running the tests,
 * so expected paths are built the same way
 */
const p = (filePath: string) => path.join(filePath)

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.spyOn(os, 'platform').mockReturnValue(platform)
}

/** Makes `which` find exactly the given paths */
function setExecutables(paths: string[]) {
  vi.spyOn(fs.promises, 'access').mockImplementation(async (filePath) => {
    if (!paths.includes(String(filePath))) {
      throw new Error('ENOENT')
    }
  })
  // `isFile()` is the only part of the stats that `which` reads
  vi.spyOn(fs.promises, 'stat').mockResolvedValue({
    isFile: () => true,
  } as fs.Stats)
}

beforeEach(() => {
  vi.stubEnv('PATH', ['/usr/local/bin', '/usr/bin'].join(path.delimiter))
  vi.stubEnv('SHELL', '/bin/zsh')
  setPlatform('darwin')
  setExecutables([])
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  mockCommands.output = {}
  mockCommands.stderr = {}
})

describe('getOsName', () => {
  it('uses the product version on macOS', async () => {
    mockCommands.output['sw_vers -productVersion'] = '15.2\n'

    expect(await getOsName()).toBe('macOS 15.2')
  })

  it('includes the kernel and distro on Linux', async () => {
    setPlatform('linux')
    vi.spyOn(os, 'release').mockReturnValue('6.8.0-49-generic')
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      [
        'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
        'NAME="Ubuntu"',
        'VERSION_ID="24.04"',
        'VERSION="24.04.1 LTS (Noble Numbat)"',
      ].join('\n'),
    )

    expect(await getOsName()).toBe(
      'Linux 6.8 Ubuntu 24.04.1 LTS 24.04.1 LTS (Noble Numbat)',
    )
  })

  it('leaves out the distro on Linux without /etc/os-release', async () => {
    setPlatform('linux')
    vi.spyOn(os, 'release').mockReturnValue('6.8.0-49-generic')
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('ENOENT'))

    expect(await getOsName()).toBe('Linux 6.8')
  })

  it('tells Windows 11 from Windows 10 by build number', async () => {
    setPlatform('win32')
    const release = vi.spyOn(os, 'release')

    release.mockReturnValue('10.0.22631')
    expect(await getOsName()).toBe('Windows 11 10.0.22631')

    release.mockReturnValue('10.0.19045')
    expect(await getOsName()).toBe('Windows 10 10.0.19045')
  })
})

describe('getShellInfo', () => {
  it('finds the version and path of $SHELL', async () => {
    setExecutables([p('/bin/zsh')])
    mockCommands.output['/bin/zsh --version'] =
      'zsh 5.9 (x86_64-apple-darwin24.0)\n'

    expect(await getShellInfo()).toEqual({
      version: '5.9',
      path: p('/bin/zsh'),
    })
  })

  it('reads the version from stderr too', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    mockCommands.output['/bin/sh --version'] = ''
    mockCommands.stderr['/bin/sh --version'] = 'version 1.2.3'

    expect(await getShellInfo()).toEqual({ version: '1.2.3' })
  })

  it('reports an unknown version when the shell has none', async () => {
    setExecutables([p('/bin/zsh')])

    expect(await getShellInfo()).toEqual({
      version: 'Unknown',
      path: p('/bin/zsh'),
    })
  })

  it('is not available on Windows', async () => {
    setPlatform('win32')

    expect(await getShellInfo()).toBeUndefined()
  })
})

describe('getNodeInfo', () => {
  it('runs the node found on PATH', async () => {
    setExecutables([p('/usr/local/bin/node')])
    mockCommands.output[`${p('/usr/local/bin/node')} -v`] = 'v24.18.1\n'

    expect(await getNodeInfo()).toEqual({
      version: '24.18.1',
      path: p('/usr/local/bin/node'),
    })
  })

  it('finds node in the current directory for an empty PATH entry', async () => {
    vi.stubEnv('PATH', ['', '/usr/local/bin'].join(path.delimiter))
    setExecutables(['node', p('/usr/local/bin/node')])
    mockCommands.output['node -v'] = 'v1.2.3\n'

    expect(await getNodeInfo()).toEqual({ version: '1.2.3', path: 'node' })
  })

  it('is undefined when node is not on PATH', async () => {
    expect(await getNodeInfo()).toBeUndefined()
  })
})

describe('getYarnInfo', () => {
  it('reports what `yarn -v` prints, as it is', async () => {
    setExecutables([p('/usr/bin/yarn')])
    mockCommands.output['yarn -v'] = '4.14.1\n'

    expect(await getYarnInfo()).toEqual({
      version: '4.14.1',
      path: p('/usr/bin/yarn'),
    })
  })

  it('is undefined when yarn fails', async () => {
    setExecutables([p('/usr/bin/yarn')])

    expect(await getYarnInfo()).toBeUndefined()
  })
})

describe('getVSCodeInfo', () => {
  it('reports the first version `code --version` prints', async () => {
    setExecutables([p('/usr/local/bin/code')])
    mockCommands.output['code --version'] =
      '1.110.1\n0f0d87fa9e96c856c5212fc86db137ac0d783365\narm64\n'

    expect(await getVSCodeInfo()).toEqual({
      version: '1.110.1',
      path: p('/usr/local/bin/code'),
    })
  })
})
