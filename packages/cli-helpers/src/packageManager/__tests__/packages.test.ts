import execa from 'execa'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import {
  addRootPackages,
  addWorkspacePackages,
  removeWorkspacePackages,
  installPackages,
} from '../packages.js'

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
}))

vi.mock('execa', () => ({
  default: Object.assign(
    vi.fn(() => Promise.resolve({ exitCode: 0 })),
    {
      sync: vi.fn(() => ({ exitCode: 0 })),
    },
  ),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPackageManager).mockReturnValue('yarn')
  vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as never)
  vi.mocked(execa.sync).mockReturnValue({ exitCode: 0 } as never)
})

describe('addRootPackages', () => {
  it('yarn: runs yarn add <packages>', async () => {
    await addRootPackages(['lodash', 'react'])
    expect(execa).toHaveBeenCalledWith('yarn', ['add', 'lodash', 'react'], {})
  })

  it('yarn: runs yarn add -D <packages> with dev flag', async () => {
    await addRootPackages(['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith('yarn', ['add', '-D', 'typescript'], {})
  })

  it('npm: runs npm install <packages>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await addRootPackages(['lodash'])
    expect(execa).toHaveBeenCalledWith('npm', ['install', 'lodash'], {})
  })

  it('npm: runs npm install -D <packages> with dev flag', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await addRootPackages(['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['install', '-D', 'typescript'],
      {},
    )
  })

  it('pnpm: runs pnpm add <packages>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await addRootPackages(['lodash'])
    expect(execa).toHaveBeenCalledWith('pnpm', ['add', 'lodash'], {})
  })

  it('pnpm: runs pnpm add -D <packages> with dev flag', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await addRootPackages(['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith('pnpm', ['add', '-D', 'typescript'], {})
  })

  it('passes execa options without the dev flag', async () => {
    await addRootPackages(['lodash'], { dev: false, cwd: '/project' })
    expect(execa).toHaveBeenCalledWith('yarn', ['add', 'lodash'], {
      cwd: '/project',
    })
  })
})

describe('addWorkspacePackages', () => {
  it('yarn: runs yarn workspace <workspace> add <packages>', async () => {
    await addWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'add', 'lodash'],
      {},
    )
  })

  it('yarn: runs yarn workspace <workspace> add -D <packages>', async () => {
    await addWorkspacePackages('web', ['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'web', 'add', '-D', 'typescript'],
      {},
    )
  })

  it('npm: runs npm install <packages> -w <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await addWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['install', 'lodash', '-w', 'api'],
      {},
    )
  })

  it('npm: runs npm install -D <packages> -w <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await addWorkspacePackages('web', ['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['install', '-D', 'typescript', '-w', 'web'],
      {},
    )
  })

  it('pnpm: runs pnpm add <packages> --filter <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await addWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['add', 'lodash', '--filter', 'api'],
      {},
    )
  })

  it('pnpm: runs pnpm add -D <packages> --filter <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await addWorkspacePackages('web', ['typescript'], { dev: true })
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['add', '-D', 'typescript', '--filter', 'web'],
      {},
    )
  })
})

describe('removeWorkspacePackages', () => {
  it('yarn: runs yarn workspace <workspace> remove <packages>', async () => {
    await removeWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'remove', 'lodash'],
      undefined,
    )
  })

  it('npm: runs npm uninstall <packages> -w <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await removeWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['uninstall', 'lodash', '-w', 'api'],
      undefined,
    )
  })

  it('pnpm: runs pnpm remove <packages> --filter <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await removeWorkspacePackages('api', ['lodash'])
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['remove', 'lodash', '--filter', 'api'],
      undefined,
    )
  })

  it('removes multiple packages at once', async () => {
    await removeWorkspacePackages('api', ['lodash', 'moment'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'remove', 'lodash', 'moment'],
      undefined,
    )
  })
})

describe('installPackages', () => {
  it('yarn: runs yarn install', async () => {
    await installPackages()
    expect(execa).toHaveBeenCalledWith('yarn', ['install'], undefined)
  })

  it('npm: runs npm install', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await installPackages()
    expect(execa).toHaveBeenCalledWith('npm', ['install'], undefined)
  })

  it('pnpm: runs pnpm install', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await installPackages()
    expect(execa).toHaveBeenCalledWith('pnpm', ['install'], undefined)
  })

  it('passes cwd option', async () => {
    await installPackages({ cwd: '/my-project' })
    expect(execa).toHaveBeenCalledWith('yarn', ['install'], {
      cwd: '/my-project',
    })
  })
})
