import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import {
  formatInstallCommand,
  formatCedarCommand,
  formatRunScriptCommand,
  formatRunWorkspaceScriptCommand,
  formatRunBinCommand,
  formatRunWorkspaceBinCommand,
  formatDlxCommand,
  formatAddRootPackagesCommand,
  formatAddWorkspacePackagesCommand,
  formatRemoveWorkspacePackagesCommand,
} from '../display.js'

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPackageManager).mockReturnValue('yarn')
})

describe('formatInstallCommand', () => {
  it('yarn: returns yarn install', () => {
    expect(formatInstallCommand()).toBe('yarn install')
  })

  it('npm: returns npm install', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatInstallCommand()).toBe('npm install')
  })

  it('pnpm: returns pnpm install', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatInstallCommand()).toBe('pnpm install')
  })
})

describe('formatCedarCommand', () => {
  it('yarn: returns yarn cedar <args>', () => {
    expect(formatCedarCommand(['build'])).toBe('yarn cedar build')
  })

  it('yarn: returns yarn cedar with multiple args', () => {
    expect(formatCedarCommand(['generate', 'page', 'home', '/'])).toBe(
      'yarn cedar generate page home /',
    )
  })

  it('yarn: returns yarn cedar with no args', () => {
    expect(formatCedarCommand([])).toBe('yarn cedar')
  })

  it('npm: returns npx cedar <args>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatCedarCommand(['build'])).toBe('npx cedar build')
  })

  it('npm: returns npx cedar with no args', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatCedarCommand([])).toBe('npx cedar')
  })

  it('pnpm: returns pnpm exec cedar <args>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatCedarCommand(['build'])).toBe('pnpm exec cedar build')
  })

  it('pnpm: returns pnpm exec cedar with no args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatCedarCommand([])).toBe('pnpm exec cedar')
  })
})

describe('formatRunScriptCommand', () => {
  it('yarn: returns yarn <script>', () => {
    expect(formatRunScriptCommand('build')).toBe('yarn build')
  })

  it('yarn: returns yarn <script> with args', () => {
    expect(formatRunScriptCommand('test', ['--watch'])).toBe(
      'yarn test --watch',
    )
  })

  it('npm: returns npm run <script>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunScriptCommand('build')).toBe('npm run build')
  })

  it('npm: returns npm run <script> -- <args>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunScriptCommand('test', ['--watch'])).toBe(
      'npm run test -- --watch',
    )
  })

  it('pnpm: returns pnpm <script>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunScriptCommand('build')).toBe('pnpm build')
  })

  it('pnpm: returns pnpm <script> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunScriptCommand('test', ['--watch'])).toBe(
      'pnpm test --watch',
    )
  })
})

describe('formatRunWorkspaceScriptCommand', () => {
  it('yarn: returns yarn workspace <workspace> <script>', () => {
    expect(formatRunWorkspaceScriptCommand('api', 'build')).toBe(
      'yarn workspace api build',
    )
  })

  it('yarn: returns yarn workspace <workspace> <script> with args', () => {
    expect(formatRunWorkspaceScriptCommand('web', 'test', ['--watch'])).toBe(
      'yarn workspace web test --watch',
    )
  })

  it('npm: returns npm run <script> -w <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunWorkspaceScriptCommand('api', 'build')).toBe(
      'npm run build -w api',
    )
  })

  it('npm: returns npm run <script> -w <workspace> -- <args>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunWorkspaceScriptCommand('web', 'test', ['--watch'])).toBe(
      'npm run test -w web -- --watch',
    )
  })

  it('pnpm: returns pnpm <script> --filter <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunWorkspaceScriptCommand('api', 'build')).toBe(
      'pnpm build --filter api',
    )
  })

  it('pnpm: returns pnpm <script> --filter <workspace> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunWorkspaceScriptCommand('web', 'test', ['--watch'])).toBe(
      'pnpm test --filter web --watch',
    )
  })
})

describe('formatRunBinCommand', () => {
  it('yarn: returns yarn <bin>', () => {
    expect(formatRunBinCommand('eslint')).toBe('yarn eslint')
  })

  it('yarn: returns yarn <bin> with args', () => {
    expect(formatRunBinCommand('eslint', ['--fix', 'src/'])).toBe(
      'yarn eslint --fix src/',
    )
  })

  it('npm: returns npx <bin>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunBinCommand('eslint')).toBe('npx eslint')
  })

  it('npm: returns npx <bin> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunBinCommand('eslint', ['--fix'])).toBe('npx eslint --fix')
  })

  it('pnpm: returns pnpm exec <bin>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunBinCommand('eslint')).toBe('pnpm exec eslint')
  })

  it('pnpm: returns pnpm exec <bin> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunBinCommand('eslint', ['--fix'])).toBe(
      'pnpm exec eslint --fix',
    )
  })
})

describe('formatRunWorkspaceBinCommand', () => {
  it('yarn: returns yarn workspace <workspace> <bin>', () => {
    expect(formatRunWorkspaceBinCommand('api', 'prisma')).toBe(
      'yarn workspace api prisma',
    )
  })

  it('yarn: returns yarn workspace <workspace> <bin> with args', () => {
    expect(
      formatRunWorkspaceBinCommand('api', 'prisma', ['migrate', 'dev']),
    ).toBe('yarn workspace api prisma migrate dev')
  })

  it('npm: returns npm exec -w <workspace> -- <bin>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRunWorkspaceBinCommand('api', 'prisma')).toBe(
      'npm exec -w api -- prisma',
    )
  })

  it('npm: returns npm exec -w <workspace> -- <bin> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(
      formatRunWorkspaceBinCommand('api', 'prisma', ['migrate', 'dev']),
    ).toBe('npm exec -w api -- prisma migrate dev')
  })

  it('pnpm: returns pnpm exec --filter <workspace> <bin>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRunWorkspaceBinCommand('api', 'prisma')).toBe(
      'pnpm exec --filter api prisma',
    )
  })

  it('pnpm: returns pnpm exec --filter <workspace> <bin> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(
      formatRunWorkspaceBinCommand('api', 'prisma', ['migrate', 'dev']),
    ).toBe('pnpm exec --filter api prisma migrate dev')
  })
})

describe('formatDlxCommand', () => {
  it('yarn: returns yarn dlx <command>', () => {
    expect(formatDlxCommand('create-react-app')).toBe(
      'yarn dlx create-react-app',
    )
  })

  it('yarn: returns yarn dlx <command> with args', () => {
    expect(formatDlxCommand('create-react-app', ['my-app'])).toBe(
      'yarn dlx create-react-app my-app',
    )
  })

  it('npm: returns npx <command>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatDlxCommand('create-react-app')).toBe('npx create-react-app')
  })

  it('npm: returns npx <command> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatDlxCommand('create-react-app', ['my-app'])).toBe(
      'npx create-react-app my-app',
    )
  })

  it('pnpm: returns pnpm dlx <command>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatDlxCommand('create-react-app')).toBe(
      'pnpm dlx create-react-app',
    )
  })

  it('pnpm: returns pnpm dlx <command> with args', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatDlxCommand('create-react-app', ['my-app'])).toBe(
      'pnpm dlx create-react-app my-app',
    )
  })
})

describe('formatAddRootPackagesCommand', () => {
  it('yarn: returns yarn add <packages>', () => {
    expect(formatAddRootPackagesCommand(['lodash', 'react'])).toBe(
      'yarn add lodash react',
    )
  })

  it('yarn: returns yarn add -D <packages> with dev flag', () => {
    expect(formatAddRootPackagesCommand(['typescript'], true)).toBe(
      'yarn add -D typescript',
    )
  })

  it('npm: returns npm install <packages>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatAddRootPackagesCommand(['lodash'])).toBe(
      'npm install lodash',
    )
  })

  it('npm: returns npm install -D <packages> with dev flag', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatAddRootPackagesCommand(['typescript'], true)).toBe(
      'npm install -D typescript',
    )
  })

  it('pnpm: returns pnpm add <packages>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatAddRootPackagesCommand(['lodash'])).toBe('pnpm add lodash')
  })

  it('pnpm: returns pnpm add -D <packages> with dev flag', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatAddRootPackagesCommand(['typescript'], true)).toBe(
      'pnpm add -D typescript',
    )
  })
})

describe('formatAddWorkspacePackagesCommand', () => {
  it('yarn: returns yarn workspace <workspace> add <packages>', () => {
    expect(formatAddWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'yarn workspace api add lodash',
    )
  })

  it('yarn: returns yarn workspace <workspace> add -D <packages>', () => {
    expect(
      formatAddWorkspacePackagesCommand('web', ['typescript'], true),
    ).toBe('yarn workspace web add -D typescript')
  })

  it('npm: returns npm install <packages> -w <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatAddWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'npm install lodash -w api',
    )
  })

  it('npm: returns npm install -D <packages> -w <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(
      formatAddWorkspacePackagesCommand('web', ['typescript'], true),
    ).toBe('npm install -D typescript -w web')
  })

  it('pnpm: returns pnpm add <packages> --filter <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatAddWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'pnpm add lodash --filter api',
    )
  })

  it('pnpm: returns pnpm add -D <packages> --filter <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(
      formatAddWorkspacePackagesCommand('web', ['typescript'], true),
    ).toBe('pnpm add -D typescript --filter web')
  })
})

describe('formatRemoveWorkspacePackagesCommand', () => {
  it('yarn: returns yarn workspace <workspace> remove <packages>', () => {
    expect(formatRemoveWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'yarn workspace api remove lodash',
    )
  })

  it('yarn: handles multiple packages', () => {
    expect(
      formatRemoveWorkspacePackagesCommand('api', ['lodash', 'moment']),
    ).toBe('yarn workspace api remove lodash moment')
  })

  it('npm: returns npm uninstall <packages> -w <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(formatRemoveWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'npm uninstall lodash -w api',
    )
  })

  it('npm: handles multiple packages', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(
      formatRemoveWorkspacePackagesCommand('api', ['lodash', 'moment']),
    ).toBe('npm uninstall lodash moment -w api')
  })

  it('pnpm: returns pnpm remove <packages> --filter <workspace>', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(formatRemoveWorkspacePackagesCommand('api', ['lodash'])).toBe(
      'pnpm remove lodash --filter api',
    )
  })

  it('pnpm: handles multiple packages', () => {
    vi.mocked(getPackageManager).mockReturnValue('pnpm')
    expect(
      formatRemoveWorkspacePackagesCommand('api', ['lodash', 'moment']),
    ).toBe('pnpm remove lodash moment --filter api')
  })
})
