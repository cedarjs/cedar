import fs from 'node:fs'
import os from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getOsName, getPackageManager, getShellPath } from '../systemInfo.js'

/** Makes `fs.readFileSync` return `contents` for `filePath`, and fail otherwise */
function mockFile(filePath: string, contents: string) {
  vi.spyOn(fs, 'readFileSync').mockImplementation((file) => {
    if (file !== filePath) {
      throw new Error('ENOENT')
    }

    return contents
  })
}

beforeEach(() => {
  vi.spyOn(os, 'platform').mockReturnValue('darwin')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getOsName', () => {
  it('reads the product version on macOS', () => {
    mockFile(
      '/System/Library/CoreServices/SystemVersion.plist',
      [
        '<dict>',
        '  <key>ProductName</key>',
        '  <string>macOS</string>',
        '  <key>ProductVersion</key>',
        '  <string>15.2</string>',
        '</dict>',
      ].join('\n'),
    )

    expect(getOsName()).toBe('macOS 15.2')
  })

  it('is just macOS when the version is unknown', () => {
    mockFile('/nowhere', '')

    expect(getOsName()).toBe('macOS')
  })

  it('includes the kernel and distro on Linux', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(os, 'release').mockReturnValue('6.8.0-49-generic')
    mockFile(
      '/etc/os-release',
      [
        'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
        'NAME="Ubuntu"',
        'VERSION_ID="24.04"',
        'VERSION="24.04.1 LTS (Noble Numbat)"',
      ].join('\n'),
    )

    expect(getOsName()).toBe('Linux 6.8 Ubuntu 24.04.1 LTS (Noble Numbat)')
  })

  it('reads unquoted values and a missing version on Linux', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(os, 'release').mockReturnValue('6.6.87.2-microsoft-standard-WSL2')
    mockFile('/etc/os-release', 'NAME=Alpine\nVERSION_ID=3.22.2\n')

    expect(getOsName()).toBe('Linux 6.6 Alpine')
  })

  it('leaves out the distro on Linux without /etc/os-release', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(os, 'release').mockReturnValue('6.8.0-49-generic')
    mockFile('/nowhere', '')

    expect(getOsName()).toBe('Linux 6.8')
  })

  it('tells Windows 11 from Windows 10 by build number', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    const release = vi.spyOn(os, 'release')

    release.mockReturnValue('10.0.22631')
    expect(getOsName()).toBe('Windows 11 10.0.22631')

    release.mockReturnValue('10.0.19045')
    expect(getOsName()).toBe('Windows 10 10.0.19045')
  })
})

describe('getShellPath', () => {
  it('is $SHELL', () => {
    vi.stubEnv('SHELL', '/bin/zsh')

    expect(getShellPath()).toBe('/bin/zsh')
  })

  it('is undefined when $SHELL is not set', () => {
    vi.stubEnv('SHELL', '')

    expect(getShellPath()).toBeUndefined()
  })
})

describe('getPackageManager', () => {
  it('reads Yarn from the user agent', () => {
    vi.stubEnv(
      'npm_config_user_agent',
      'yarn/4.14.1 npm/? node/v24.11.0 darwin arm64',
    )

    expect(getPackageManager()).toEqual({ name: 'yarn', version: '4.14.1' })
  })

  it('reads npm from the user agent', () => {
    vi.stubEnv(
      'npm_config_user_agent',
      'npm/11.6.1 node/v24.11.0 darwin arm64 workspaces/false',
    )

    expect(getPackageManager()).toEqual({ name: 'npm', version: '11.6.1' })
  })

  it('is undefined without a user agent', () => {
    vi.stubEnv('npm_config_user_agent', '')

    expect(getPackageManager()).toBeUndefined()
  })

  it('is undefined for a user agent it does not understand', () => {
    vi.stubEnv('npm_config_user_agent', 'something else')

    expect(getPackageManager()).toBeUndefined()
  })
})
