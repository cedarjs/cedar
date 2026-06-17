globalThis.__dirname = __dirname
import path from 'path'

import { beforeAll, test, expect } from 'vitest'
import yargs from 'yargs/yargs'

// Shared mocks for paths, etc.
import '../../../../lib/test'

// @ts-expect-error - importing js
import * as component from '../component.js'
// @ts-expect-error - importing js
import * as componentHandler from '../componentHandler.js'

let singleWordDefaultFiles: Record<string, string>
let multiWordDefaultFiles: Record<string, string>
let javascriptFiles: Record<string, string>
let typescriptFiles: Record<string, string>
let withoutTestFiles: Record<string, string>
let withoutStoryFiles: Record<string, string>

beforeAll(async () => {
  singleWordDefaultFiles = await componentHandler.files({
    name: 'User',
    tests: true,
    stories: true,
  })
  multiWordDefaultFiles = await componentHandler.files({
    name: 'UserProfile',
    tests: true,
    stories: true,
  })
  javascriptFiles = await componentHandler.files({
    name: 'JavascriptUser',
    typescript: false,
    stories: true,
    tests: true,
  })
  typescriptFiles = await componentHandler.files({
    name: 'TypescriptUser',
    typescript: true,
    stories: true,
    tests: true,
  })
  withoutTestFiles = await componentHandler.files({
    name: 'withoutTests',
    stories: true,
    tests: false,
  })
  withoutStoryFiles = await componentHandler.files({
    name: 'withoutStories',
    tests: true,
    stories: false,
  })
})

test('returns exactly 3 files', () => {
  expect(Object.keys(singleWordDefaultFiles).length).toEqual(3)
})

test('keeps Component in name', async () => {
  const isPromiseLike = <T>(obj: unknown): obj is Promise<T> => {
    if (!!obj && typeof obj === 'object') {
      if ('then' in obj) {
        return true
      }
    }

    return false
  }

  const argv = yargs()
    .command('component <name>', false, component.builder)
    .parse('component BazingaComponent')

  const name = isPromiseLike(argv) ? (await argv).name : argv.name

  expect(name).toEqual('BazingaComponent')
})

test('creates a single word component', () => {
  expect(
    singleWordDefaultFiles[
      path.normalize('/path/to/project/web/src/components/User/User.jsx')
    ],
  ).toMatchSnapshot()
})

test('creates a single word component test', () => {
  expect(
    singleWordDefaultFiles[
      path.normalize('/path/to/project/web/src/components/User/User.test.jsx')
    ],
  ).toMatchSnapshot()
})

test('creates a single word component story', () => {
  expect(
    singleWordDefaultFiles[
      path.normalize(
        '/path/to/project/web/src/components/User/User.stories.jsx',
      )
    ],
  ).toMatchSnapshot()
})

test('creates a multi word component', () => {
  expect(
    multiWordDefaultFiles[
      path.normalize(
        '/path/to/project/web/src/components/UserProfile/UserProfile.jsx',
      )
    ],
  ).toMatchSnapshot()
})

test('creates a TS component and test', () => {
  expect(
    typescriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/TypescriptUser/TypescriptUser.tsx',
      )
    ],
  ).toMatchSnapshot()
  expect(
    typescriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/TypescriptUser/TypescriptUser.test.tsx',
      )
    ],
  ).toMatchSnapshot()
})

test('creates a multi word component test', () => {
  expect(
    multiWordDefaultFiles[
      path.normalize(
        '/path/to/project/web/src/components/UserProfile/UserProfile.test.jsx',
      )
    ],
  ).toMatchSnapshot()
})

test('creates a multi word component story', () => {
  expect(
    multiWordDefaultFiles[
      path.normalize(
        '/path/to/project/web/src/components/UserProfile/UserProfile.stories.jsx',
      )
    ],
  ).toMatchSnapshot()
})

test('creates JS component files if typescript = false', () => {
  expect(
    javascriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/JavascriptUser/JavascriptUser.jsx',
      )
    ],
  ).not.toBeUndefined()
  expect(
    javascriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/JavascriptUser/JavascriptUser.test.jsx',
      )
    ],
  ).not.toBeUndefined()
})

test('creates TS component files if typescript = true', () => {
  expect(
    typescriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/TypescriptUser/TypescriptUser.tsx',
      )
    ],
  ).not.toBeUndefined()
  expect(
    typescriptFiles[
      path.normalize(
        '/path/to/project/web/src/components/TypescriptUser/TypescriptUser.test.tsx',
      )
    ],
  ).not.toBeUndefined()
})

test("doesn't include storybook file when --stories is set to false", () => {
  expect(Object.keys(withoutStoryFiles)).toEqual([
    path.normalize(
      '/path/to/project/web/src/components/WithoutStories/WithoutStories.test.jsx',
    ),
    path.normalize(
      '/path/to/project/web/src/components/WithoutStories/WithoutStories.jsx',
    ),
  ])
})

test("doesn't include test file when --tests is set to false", () => {
  expect(Object.keys(withoutTestFiles)).toEqual([
    path.normalize(
      '/path/to/project/web/src/components/WithoutTests/WithoutTests.stories.jsx',
    ),
    path.normalize(
      '/path/to/project/web/src/components/WithoutTests/WithoutTests.jsx',
    ),
  ])
})
