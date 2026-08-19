vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => {
      return {
        base: path.join('mocked', 'project'),
      }
    },
  }
})
vi.mock('@cedarjs/cli-helpers', () => {
  return {
    colors: Object.fromEntries(
      [
        'error',
        'warning',
        'highlight',
        'success',
        'info',
        'bold',
        'underline',
        'note',
        'tip',
        'important',
        'caution',
        'link',
      ].map((k) => [k, (s: string) => s]),
    ),
    getCompatibilityData: vi.fn(() => {
      throw new Error('Mock Not Implemented')
    }),
  }
})
vi.mock('node:fs')
vi.mock('@cedarjs/cli-helpers/packageManager/exec', async () => {
  const actual = await vi.importActual(
    '@cedarjs/cli-helpers/packageManager/exec',
  )
  return {
    ...actual,
    dlx: vi.fn(),
  }
})

vi.mock('enquirer', () => {
  return {
    default: {
      // Needs to be a `function` (not an arrow function), since Vitest 4
      // forwards `new Select(...)` calls to the mock implementation
      Select: vi.fn(function () {
        return {
          run: vi.fn(() => {
            throw new Error('Mock Not Implemented')
          }),
        }
      }),
    },
  }
})

import path from 'path'

import enq from 'enquirer'
import { vol } from 'memfs'
import { vi, describe, beforeEach, afterEach, test, expect } from 'vitest'

const mockEnq = enq as unknown as { Select: ReturnType<typeof vi.fn> }

import { getCompatibilityData } from '@cedarjs/cli-helpers'
import { dlx } from '@cedarjs/cli-helpers/packageManager/exec'

import { handler } from '../packageHandler.js'

describe('packageHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    vol.fromJSON({
      ['package.json']: JSON.stringify({
        devDependencies: {
          '@cedarjs/core': '1.0.0',
        },
      }),
    })
  })

  afterEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  test('using force does not check compatibility', async () => {
    await handler({
      npmPackage: 'some-package',
      force: true,
      _: ['setup', 'package'],
    })

    expect(console.log).toHaveBeenCalledWith(
      'No compatibility check will be performed because you used the --force flag.',
    )
    expect(getCompatibilityData).not.toHaveBeenCalled()
  })

  test('using force warns of experimental package if possible', async () => {
    await handler({
      npmPackage: 'some-package',
      force: true,
      _: ['setup', 'package'],
    })
    await handler({
      npmPackage: 'some-package@latest',
      force: true,
      _: ['setup', 'package'],
    })

    await handler({
      npmPackage: 'some-package@0.0.1',
      force: true,
      _: ['setup', 'package'],
    })
    expect(console.log).toHaveBeenCalledWith(
      'Be aware that this package is under version 1.0.0 and so should be considered experimental.',
    )
  })

  test('compatiblity check error prompts to continue', async () => {
    vi.mocked(getCompatibilityData).mockImplementation(() => {
      throw new Error('No compatible version found')
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'cancel'),
      }
    })
    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })
    expect(mockEnq.Select).toHaveBeenCalledTimes(1)
    expect(dlx).not.toHaveBeenCalled()

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'continue'),
      }
    })
    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })
    expect(mockEnq.Select).toHaveBeenCalledTimes(2)
    expect(dlx).toHaveBeenCalledWith('some-package@latest', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })
  })

  test('default of latest is compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '1.0.0',
        tag: 'latest',
      },
      compatible: {
        version: '1.0.0',
        tag: 'latest',
      },
    })

    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenCalledWith('some-package', 'latest')
    expect(dlx).toHaveBeenCalledWith('some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })
  })

  test('default of latest is not compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '2.0.0',
        tag: 'latest',
      },
      compatible: {
        version: '1.0.0',
        tag: undefined,
      },
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'useLatestCompatibleVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      1,
      'some-package',
      'latest',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(1)
    expect(dlx).toHaveBeenNthCalledWith(1, 'some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'usePreferredVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      2,
      'some-package',
      'latest',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(2)
    expect(dlx).toHaveBeenNthCalledWith(2, 'some-package@2.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'cancel'),
      }
    })
    await handler({
      npmPackage: 'some-package',
      force: false,
      _: ['setup', 'package'],
    })

    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      3,
      'some-package',
      'latest',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(3)
    expect(dlx).toBeCalledTimes(2) // Only called for the previous two select options
  })

  test('tag is compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '1.0.0',
        tag: 'stable',
      },
      compatible: {
        version: '1.0.0',
        tag: 'stable',
      },
    })

    await handler({
      npmPackage: 'some-package@stable',
      force: false,
      _: ['setup', 'package'],
    })

    expect(getCompatibilityData).toHaveBeenCalledWith('some-package', 'stable')
    expect(dlx).toHaveBeenCalledWith('some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })
  })

  test('tag is not compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '2.0.0',
        tag: 'stable',
      },
      compatible: {
        version: '1.0.0',
        tag: undefined,
      },
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'useLatestCompatibleVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package@stable',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      1,
      'some-package',
      'stable',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(1)
    expect(dlx).toHaveBeenNthCalledWith(1, 'some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'usePreferredVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package@stable',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      2,
      'some-package',
      'stable',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(2)
    expect(dlx).toHaveBeenNthCalledWith(2, 'some-package@2.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'cancel'),
      }
    })
    await handler({
      npmPackage: 'some-package@stable',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      3,
      'some-package',
      'stable',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(3)
    expect(dlx).toBeCalledTimes(2) // Only called for the previous two select options
  })

  test('specific version is compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '1.0.0',
        tag: 'latest',
      },
      compatible: {
        version: '1.0.0',
        tag: 'latest',
      },
    })

    await handler({
      npmPackage: 'some-package@1.0.0',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenCalledWith('some-package', '1.0.0')
    expect(dlx).toHaveBeenCalledWith('some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })
  })

  test('specific version is not compatible', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '2.0.0',
        tag: 'latest',
      },
      compatible: {
        version: '1.0.0',
        tag: undefined,
      },
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'useLatestCompatibleVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package@1.0.0',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      1,
      'some-package',
      '1.0.0',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(1)
    expect(dlx).toHaveBeenNthCalledWith(1, 'some-package@1.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'usePreferredVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package@1.0.0',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      2,
      'some-package',
      '1.0.0',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(2)
    expect(dlx).toHaveBeenNthCalledWith(2, 'some-package@2.0.0', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })

    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'cancel'),
      }
    })
    await handler({
      npmPackage: 'some-package@1.0.0',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      3,
      'some-package',
      '1.0.0',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(3)
    expect(dlx).toBeCalledTimes(2) // Only called for the previous two select options
  })

  test('specific version is experimental', async () => {
    vi.mocked(getCompatibilityData).mockResolvedValue({
      preferred: {
        version: '0.0.1',
        tag: 'latest',
      },
      compatible: {
        version: '0.0.1',
        tag: 'latest',
      },
    })

    // Force should just log to the console
    await handler({
      npmPackage: 'some-package@0.0.1',
      force: true,
      _: ['setup', 'package'],
    })
    expect(console.log).toHaveBeenCalledWith(
      'Be aware that this package is under version 1.0.0 and so should be considered experimental.',
    )

    // No force should prompt
    vi.mocked(mockEnq.Select).mockImplementation(function () {
      return {
        run: vi.fn(() => 'useLatestCompatibleVersion'),
      }
    })
    await handler({
      npmPackage: 'some-package@0.0.1',
      force: false,
      _: ['setup', 'package'],
    })
    expect(getCompatibilityData).toHaveBeenNthCalledWith(
      1,
      'some-package',
      '0.0.1',
    )
    expect(mockEnq.Select).toHaveBeenCalledTimes(1)
    // Verify the prompt message contains the experimental warning
    expect(mockEnq.Select.mock.calls[0][0]?.message).toContain('experimental')
    expect(dlx).toHaveBeenNthCalledWith(1, 'some-package@0.0.1', [], {
      stdio: 'inherit',
      cwd: path.join('mocked', 'project'),
    })
  })
})
