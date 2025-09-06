import execa from 'execa'
import { vi, it, expect, afterAll } from 'vitest'

// @ts-expect-error JS file import
import * as deployNetlify from '../netlify.js'

vi.mock('path')
vi.mock('execa', () => ({
  default: vi.fn(),
}))
vi.mock('fs-extra')

vi.mock('yargs', () => ({
  argv: [],
  parse: vi.fn(),
}))

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig: object = await importOriginal()

  return {
    ...originalProjectConfig,
    getPaths: () => ({
      base: `${__dirname}/fixtures`,
    }),
  }
})

vi.mock('@cedarjs/cli-helpers', async () => {
  return {
    recordTelemetryAttributes: vi.fn(),
  }
})

vi.spyOn(console, 'log').mockImplementation(() => {})

afterAll(() => {
  vi.restoreAllMocks()
})

it('should export a command', async () => {
  expect(deployNetlify.command).toMatch(/netlify/)
})

it('should export a description', async () => {
  expect(deployNetlify.description).toMatch('Build command for Netlify deploy')
})

it('should export a builder function', async () => {
  const yargs = {
    option: vi.fn().mockImplementation(() => yargs),
    epilogue: vi.fn().mockImplementation(() => yargs),
  }

  deployNetlify.builder(yargs)

  expect(yargs.option).toHaveBeenCalledWith('build', {
    description: 'Build for production',
    type: 'boolean',
    default: 'true',
  })
  expect(yargs.option).toHaveBeenCalledWith('prisma', {
    description: 'Apply database migrations',
    type: 'boolean',
    default: 'true',
  })
})

it('should export a handler function', async () => {
  await deployNetlify.handler({ prisma: true })

  expect(execa).toHaveBeenCalledWith('yarn rw prisma migrate deploy', {
    shell: true,
    stdio: 'inherit',
    cwd: expect.stringContaining('fixtures'),
    extendEnv: true,
    cleanup: true,
  })
})
