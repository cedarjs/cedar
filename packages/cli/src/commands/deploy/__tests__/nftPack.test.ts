import { vi, test, expect } from 'vitest'

import { findApiDistFunctions } from '@cedarjs/internal/dist/files'

import * as nftPacker from '../packing/nft.js'

vi.mock('@vercel/nft', () => {
  return {
    nodeFileTrace: vi.fn(),
  }
})

vi.mock('@cedarjs/internal/dist/files', () => {
  return {
    findApiDistFunctions: (_opts?: { cwd?: string }) => {
      return [
        '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/dist/functions/graphql.js',
        '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/dist/functions/healthz/healthz.js',
        '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/dist/functions/invalid/x.js',
        '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/dist/functions/nested/nested.js',
        '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/dist/functions/x/index.js',
      ]
    },
  }
})

vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => {
      return {
        base: '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/',
        api: {
          base: '/Users/carmack/dev/cedar/__fixtures__/example-todo-main/api/',
        },
      }
    },
    ensurePosixPath: (path: string) => {
      return path.replace(/\\/g, '/')
    },
  }
})

test('Check packager detects all functions', () => {
  const packageFileMock = vi
    .spyOn(nftPacker, 'packageSingleFunction')
    .mockResolvedValue(undefined)

  nftPacker.nftPack()

  expect(packageFileMock).toHaveBeenCalledTimes(5)
})

test('Creates entry file for nested functions correctly', () => {
  const nestedFunction = findApiDistFunctions({ cwd: '/api' }).find(
    (fPath: string) => fPath.includes('nested'),
  )

  const [outputPath, content] = nftPacker.generateEntryFile(
    nestedFunction!,
    'nested',
  )

  expect(outputPath).toBe('./api/dist/zipball/nested/nested.js')
  expect(content).toMatchInlineSnapshot(
    `"module.exports = require('./api/dist/functions/nested/nested.js')"`,
  )
})

test('Creates entry file for top level functions correctly', () => {
  const graphqlFunction = findApiDistFunctions({ cwd: '/api' }).find(
    (fPath: string) => fPath.includes('graphql'),
  )

  const [outputPath, content] = nftPacker.generateEntryFile(
    graphqlFunction!,
    'graphql',
  )

  expect(outputPath).toBe('./api/dist/zipball/graphql/graphql.js')
  expect(content).toMatchInlineSnapshot(
    `"module.exports = require('./api/dist/functions/graphql.js')"`,
  )
})
