import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import execa from 'execa'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type * as ProjectConfigModule from '@cedarjs/project-config'

const { projectPaths, promptMock } = vi.hoisted(() => ({
  projectPaths: { base: '' },
  promptMock: vi.fn(async () => ({ confirmed: true })),
}))

vi.mock('@cedarjs/project-config', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectConfigModule>()),
  getPaths: () => projectPaths,
}))
vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
  resetPackageManagerCache: vi.fn(),
}))
vi.mock('prompts', () => ({ default: promptMock }))

// A partial execa stand-in for the dropped-connection test: it fails the
// branch fetch and delegates everything else to the real execa
const realExecaPromise = import('execa')
const failingBranchFetchExeca = vi.fn(async (_cmd: string, args: string[]) => {
  if (args[0] === 'fetch' && args[2] === 'refs/heads/release') {
    throw Object.assign(new Error('connection reset'), { exitCode: 128 })
  }

  const { default: realExeca } = await realExecaPromise

  return realExeca(_cmd, args, { cwd: projectPaths.base })
})

import {
  serverConfigWithDefaults,
  warnIfUnpushedCommits,
} from '../baremetal/baremetalHandler.js'
import type {
  BaremetalYargs,
  ServerConfig,
} from '../baremetal/baremetalHandler.js'

describe('warnIfUnpushedCommits with git', () => {
  const tempDirs: string[] = []
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const yargs: BaremetalYargs = {
    environment: 'production',
    releaseDir: '20220409120000',
    yes: false,
  }
  let tempDir: string
  let originRepo: string
  // An empty file git reads instead of the user's global config, so the tests
  // see the same git behavior on every machine. `os.devNull` can't be used:
  // the Windows path form (`\\.\nul`) is rejected by git.
  let emptyGitConfig: string
  let originalEnv: { GIT_CONFIG_GLOBAL?: string; GIT_CONFIG_NOSYSTEM?: string }

  const git = (args: string[], cwd = projectPaths.base) =>
    execa('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd,
      env: {
        GIT_AUTHOR_NAME: 'Cedar Test',
        GIT_AUTHOR_EMAIL: 'cedar-test@example.com',
        GIT_COMMITTER_NAME: 'Cedar Test',
        GIT_COMMITTER_EMAIL: 'cedar-test@example.com',
        GIT_CONFIG_GLOBAL: emptyGitConfig,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    })

  const commit = async (message: string) => {
    await git(['commit', '--allow-empty', '-m', message])
    const { stdout } = await git(['log', '-1', '--oneline'])
    return stdout.trim()
  }

  const serverConfig = (
    overrides: Partial<ServerConfig> = {},
    args = yargs,
  ): ServerConfig =>
    serverConfigWithDefaults(
      {
        host: 'prod1.server.test',
        username: 'deploy',
        path: '/var/www/app',
        repo: originRepo,
        ...overrides,
      },
      args,
    )

  beforeEach(async () => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-baremetal-git-')),
    )
    tempDirs.push(tempDir)
    projectPaths.base = path.join(tempDir, 'app')
    originRepo = path.join(tempDir, 'origin.git')
    emptyGitConfig = path.join(tempDir, 'git-config')
    fs.writeFileSync(emptyGitConfig, '')
    fs.mkdirSync(projectPaths.base)

    // The processes warnIfUnpushedCommits spawns inherit the environment of
    // the test process, so the isolation applies here too, not just in the
    // git helper. A user's global `log.decorate` setting would otherwise
    // change the output the assertions compare against
    originalEnv = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    }
    process.env.GIT_CONFIG_GLOBAL = emptyGitConfig
    process.env.GIT_CONFIG_NOSYSTEM = '1'

    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    })
    promptMock.mockReset().mockResolvedValue({ confirmed: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await git(['init', '--bare', '--initial-branch=main', originRepo], tempDir)
    await git(['init', '--initial-branch=main'])
    await git(['remote', 'add', 'origin', originRepo])
    await commit('commit A')
    await git(['push', '-u', 'origin', 'main'])
  })

  afterEach(() => {
    if (originalIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY')
    }
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
    vi.restoreAllMocks()
  })

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns about local commits missing from the deploy branch', async () => {
    const localCommit = await commit('local change')

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(promptMock).toHaveBeenCalledOnce()
  })

  it('checks a local branch without an upstream', async () => {
    await git(['checkout', '-b', 'feature'])
    const localCommit = await commit('feature change')

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(promptMock).toHaveBeenCalledOnce()
  })

  it('warns about fully pushed feature commits missing from deployed main', async () => {
    await git(['checkout', '-b', 'feature-x'])
    const featureCommit = await commit('feature change')
    await git(['push', '-u', 'origin', 'feature-x'])
    expect((await git(['log', '@{u}..HEAD', '--oneline'])).stdout).toBe('')

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).toHaveBeenCalledWith(`  ${featureCommit}`)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"main" branch'),
    )
  })

  it('compares the resolved --branch override while HEAD is on main', async () => {
    const localCommit = await commit('release change')
    await git(['push', 'origin', 'HEAD:release'])
    const releaseArgs = { ...yargs, branch: 'release' }

    await warnIfUnpushedCommits(releaseArgs, [
      serverConfig({ branch: 'main' }, releaseArgs),
    ])

    expect(console.warn).not.toHaveBeenCalled()
    expect(promptMock).not.toHaveBeenCalled()

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"main" branch'),
    )
  })

  it('does not warn when the deploy branch is ahead of HEAD', async () => {
    await commit('remote change')
    await git(['push', 'origin', 'main'])
    await git(['reset', '--hard', 'HEAD~1'])

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).not.toHaveBeenCalled()
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('uses the deploy repo even when the local upstream is missing HEAD', async () => {
    const localCommit = await commit('deploy change')
    const deployRepo = path.join(tempDir, 'deploy.git')
    await git(['init', '--bare', '--initial-branch=main', deployRepo], tempDir)
    await git(['push', deployRepo, 'HEAD:main'])
    expect((await git(['log', '@{u}..HEAD', '--oneline'])).stdout).toBe(
      localCommit,
    )

    await warnIfUnpushedCommits(yargs, [serverConfig({ repo: deployRepo })])

    expect(console.warn).not.toHaveBeenCalled()
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('fetches the configured repo path without any local remotes', async () => {
    await git(['remote', 'remove', 'origin'])
    const localCommit = await commit('local change')
    expect((await git(['remote'])).stdout).toBe('')

    await warnIfUnpushedCommits(yargs, [serverConfig()])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
  })

  it('accepts a lightweight tag as the configured branch', async () => {
    await git(['tag', 'v1.0.0'])
    await git(['push', 'origin', 'v1.0.0'])
    const localCommit = await commit('local change')

    await warnIfUnpushedCommits(yargs, [serverConfig({ branch: 'v1.0.0' })])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"v1.0.0" branch'),
    )
  })

  it('matches clone --branch when a branch and a tag share a name', async () => {
    await commit('branch move')
    await git(['push', 'origin', 'HEAD:refs/heads/release'])
    await git(['tag', 'release', 'HEAD~1'])
    await git(['push', 'origin', 'refs/tags/release'])
    const localCommit = await commit('local change')

    await warnIfUnpushedCommits(yargs, [serverConfig({ branch: 'release' })])

    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"release" branch'),
    )
  })

  it('rejects a failed branch fetch instead of comparing against the tag', async () => {
    await commit('branch move')
    await git(['push', 'origin', 'HEAD:refs/heads/release'])
    await git(['tag', 'release', 'HEAD~1'])
    await git(['push', 'origin', 'refs/tags/release'])

    // A connection that drops mid-fetch fails the branch fetch even though
    // the branch exists, so the check must not fall back to the tag
    vi.doMock('execa', () => ({ default: failingBranchFetchExeca }))

    try {
      vi.resetModules()
      const { warnIfUnpushedCommits: warnWithFailingFetch } =
        await import('../baremetal/baremetalHandler.js')
      const check = warnWithFailingFetch(yargs, [
        serverConfig({ branch: 'release' }),
      ])

      await expect(check).rejects.toThrow(
        'git fetch failed while checking the deploy branch "release"',
      )
      expect(failingBranchFetchExeca).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['refs/tags/release']),
      )
    } finally {
      vi.doUnmock('execa')
    }
  })

  it('groups servers sharing the same repo and branch into one warning', async () => {
    const localCommit = await commit('local change')

    await warnIfUnpushedCommits(yargs, [
      serverConfig(),
      serverConfig({ host: 'prod2.server.test' }),
    ])

    expect(console.warn).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('prod1.server.test prod2.server.test'),
    )
    expect(console.warn).toHaveBeenCalledWith(`  ${localCommit}`)
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining(originRepo),
    )
    expect(promptMock).toHaveBeenCalledOnce()
  })

  it('compares each branch before fetching the next target', async () => {
    const releaseCommit = await commit('release change')
    await git(['push', 'origin', 'HEAD:release'])
    const localCommit = await commit('local change')

    await warnIfUnpushedCommits(yargs, [
      serverConfig(),
      serverConfig({ host: 'prod2.server.test', branch: 'release' }),
    ])

    expect(console.warn).toHaveBeenCalledTimes(5)
    expect(console.warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"main" branch'),
    )
    expect(console.warn).toHaveBeenNthCalledWith(
      2,
      `  ${localCommit}\n  ${releaseCommit}`,
    )
    expect(console.warn).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('"release" branch'),
    )
    expect(console.warn).toHaveBeenNthCalledWith(4, `  ${localCommit}`)
    expect(promptMock).toHaveBeenCalledOnce()
  })

  it('rejects a missing deploy branch without exposing the repo', async () => {
    const check = warnIfUnpushedCommits(yargs, [
      serverConfig({ branch: 'missing-branch' }),
    ])

    await expect(check).rejects.toThrow(
      'git fetch failed while checking the deploy branch "missing-branch"',
    )
    await expect(check).rejects.not.toThrow(originRepo)
    await expect(check).rejects.not.toHaveProperty('cause')
    expect(promptMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not compare HEAD with the deploy branch'),
    )
  })
})
