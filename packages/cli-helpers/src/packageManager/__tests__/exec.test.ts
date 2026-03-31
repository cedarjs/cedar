import execa from 'execa'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import {
  runScript,
  runScriptSync,
  runWorkspaceScript,
  runBin,
  runBinSync,
  runWorkspaceBin,
  dlx,
} from '../exec.js'

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

describe('runScript', () => {
  it('yarn: runs yarn <script>', async () => {
    await runScript('build')
    expect(execa).toHaveBeenCalledWith('yarn', ['build'], undefined)
  })

  it('yarn: runs yarn <script> with args', async () => {
    await runScript('test', ['--watch'])
    expect(execa).toHaveBeenCalledWith('yarn', ['test', '--watch'], undefined)
  })

  it('npm: runs npm run <script>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runScript('build')
    expect(execa).toHaveBeenCalledWith('npm', ['run', 'build'], undefined)
  })

  it('npm: runs npm run <script> -- <args>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runScript('test', ['--watch'])
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['run', 'test', '--', '--watch'],
      undefined,
    )
  })

  it('pnpm: runs pnpm <script>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runScript('build')
    expect(execa).toHaveBeenCalledWith('pnpm', ['build'], undefined)
  })

  it('pnpm: runs pnpm <script> with args', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runScript('test', ['--watch'])
    expect(execa).toHaveBeenCalledWith('pnpm', ['test', '--watch'], undefined)
  })

  it('passes options through', async () => {
    await runScript('build', [], { cwd: '/some/dir' })
    expect(execa).toHaveBeenCalledWith('yarn', ['build'], { cwd: '/some/dir' })
  })
})

describe('runScriptSync', () => {
  it('yarn: runs yarn <script> synchronously', () => {
    runScriptSync('build')
    expect(execa.sync).toHaveBeenCalledWith('yarn', ['build'], undefined)
  })

  it('npm: runs npm run <script> synchronously', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    runScriptSync('build')
    expect(execa.sync).toHaveBeenCalledWith('npm', ['run', 'build'], undefined)
  })

  it('npm: runs npm run <script> -- <args> synchronously', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    runScriptSync('test', ['--watch'])
    expect(execa.sync).toHaveBeenCalledWith(
      'npm',
      ['run', 'test', '--', '--watch'],
      undefined,
    )
  })

  it('pnpm: runs pnpm <script> synchronously', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    runScriptSync('build')
    expect(execa.sync).toHaveBeenCalledWith('pnpm', ['build'], undefined)
  })
})

describe('runWorkspaceScript', () => {
  it('yarn: runs yarn workspace <workspace> <script>', async () => {
    await runWorkspaceScript('api', 'build')
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'build'],
      undefined,
    )
  })

  it('yarn: runs yarn workspace <workspace> <script> with args', async () => {
    await runWorkspaceScript('web', 'test', ['--watch'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'web', 'test', '--watch'],
      undefined,
    )
  })

  it('npm: runs npm run <script> -w <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runWorkspaceScript('api', 'build')
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['run', 'build', '-w', 'api'],
      undefined,
    )
  })

  it('npm: runs npm run <script> -w <workspace> -- <args>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runWorkspaceScript('web', 'test', ['--watch'])
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['run', 'test', '-w', 'web', '--', '--watch'],
      undefined,
    )
  })

  it('pnpm: runs pnpm <script> --filter <workspace>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runWorkspaceScript('api', 'build')
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['build', '--filter', 'api'],
      undefined,
    )
  })

  it('pnpm: runs pnpm <script> --filter <workspace> with args', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runWorkspaceScript('web', 'test', ['--watch'])
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['test', '--filter', 'web', '--', '--watch'],
      undefined,
    )
  })
})

describe('runBin', () => {
  it('yarn: runs yarn <bin>', async () => {
    await runBin('eslint')
    expect(execa).toHaveBeenCalledWith('yarn', ['eslint'], undefined)
  })

  it('yarn: runs yarn <bin> with args', async () => {
    await runBin('eslint', ['--fix', 'src/'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['eslint', '--fix', 'src/'],
      undefined,
    )
  })

  it('npm: runs npx <bin>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runBin('eslint')
    expect(execa).toHaveBeenCalledWith('npx', ['eslint'], undefined)
  })

  it('npm: runs npx <bin> with args', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runBin('eslint', ['--fix'])
    expect(execa).toHaveBeenCalledWith('npx', ['eslint', '--fix'], undefined)
  })

  it('pnpm: runs pnpm exec <bin>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runBin('eslint')
    expect(execa).toHaveBeenCalledWith('pnpm', ['exec', 'eslint'], undefined)
  })

  it('pnpm: runs pnpm exec <bin> with args', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runBin('eslint', ['--fix'])
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'eslint', '--fix'],
      undefined,
    )
  })

  it('passes options through', async () => {
    await runBin('eslint', [], { cwd: '/project' })
    expect(execa).toHaveBeenCalledWith('yarn', ['eslint'], { cwd: '/project' })
  })
})

describe('runBinSync', () => {
  it('yarn: runs yarn <bin> synchronously', () => {
    runBinSync('rw-gen')
    expect(execa.sync).toHaveBeenCalledWith('yarn', ['rw-gen'], undefined)
  })

  it('npm: runs npx <bin> synchronously', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    runBinSync('rw-gen')
    expect(execa.sync).toHaveBeenCalledWith('npx', ['rw-gen'], undefined)
  })

  it('pnpm: runs pnpm exec <bin> synchronously', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    runBinSync('rw-gen')
    expect(execa.sync).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'rw-gen'],
      undefined,
    )
  })
})

describe('runWorkspaceBin', () => {
  it('yarn: runs yarn workspace <workspace> <bin>', async () => {
    await runWorkspaceBin('api', 'prisma')
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'prisma'],
      undefined,
    )
  })

  it('npm: runs npm exec -w <workspace> -- <bin>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await runWorkspaceBin('api', 'prisma')
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['exec', '-w', 'api', '--', 'prisma'],
      undefined,
    )
  })

  it('pnpm: runs pnpm exec --filter <workspace> <bin>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await runWorkspaceBin('api', 'prisma')
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['exec', '--filter', 'api', 'prisma'],
      undefined,
    )
  })

  it('passes args correctly for yarn', async () => {
    await runWorkspaceBin('api', 'prisma', ['migrate', 'dev'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['workspace', 'api', 'prisma', 'migrate', 'dev'],
      undefined,
    )
  })
})

describe('dlx', () => {
  it('yarn: runs yarn dlx <command>', async () => {
    await dlx('create-react-app')
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['dlx', 'create-react-app'],
      undefined,
    )
  })

  it('npm: runs npx <command>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    await dlx('create-react-app')
    expect(execa).toHaveBeenCalledWith('npx', ['create-react-app'], undefined)
  })

  it('pnpm: runs pnpm dlx <command>', async () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    await dlx('create-react-app')
    expect(execa).toHaveBeenCalledWith(
      'pnpm',
      ['dlx', 'create-react-app'],
      undefined,
    )
  })

  it('passes args correctly', async () => {
    await dlx('create-react-app', ['my-app'])
    expect(execa).toHaveBeenCalledWith(
      'yarn',
      ['dlx', 'create-react-app', 'my-app'],
      undefined,
    )
  })
})
