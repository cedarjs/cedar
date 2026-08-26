import fs from 'node:fs'
import path from 'path'

import * as babel from '@babel/core'
import { beforeAll, test, expect, afterAll } from 'vitest'

import {
  getApiSideBabelPlugins,
  getApiSideDefaultBabelConfig,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { ensurePosixPath, getPaths } from '@cedarjs/project-config'

import { cleanApiBuild } from '../build/api.js'
import { findApiFiles } from '../files.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../__fixtures__/example-todo-main',
)

// @NOTE: we no longer prebuild files into the .cedar/prebuild folder
// However, prebuilding in the tests is still helpful for us to validate
// that everything is working as expected.
export const prebuildApiFiles = async (srcFiles: string[]) => {
  const rwjsPaths = getPaths()
  const plugins = getApiSideBabelPlugins()

  return Promise.all(
    srcFiles.map(async (srcPath) => {
      const relativePathFromSrc = path.relative(rwjsPaths.base, srcPath)
      const dstPath = path
        .join(rwjsPaths.generated.prebuild, relativePathFromSrc)
        .replace(/\.(ts)$/, '.js')

      const fileContents = fs.readFileSync(srcPath, 'utf-8')
      const result = await transformWithBabel(fileContents, srcPath, plugins)
      if (!result?.code) {
        throw new Error(`Could not prebuild ${srcPath}`)
      }

      fs.mkdirSync(path.dirname(dstPath), { recursive: true })
      fs.writeFileSync(dstPath, result.code)

      return dstPath
    }),
  )
}

const cleanPaths = (p: string) => {
  return ensurePosixPath(path.relative(FIXTURE_PATH, p))
}

// Fixtures, filled in beforeAll
let prebuiltFiles: string[]
let relativePaths: string[]

beforeAll(async () => {
  process.env.CEDAR_CWD = FIXTURE_PATH
  cleanApiBuild()

  const apiFiles = findApiFiles()
  prebuiltFiles = await prebuildApiFiles(apiFiles)

  relativePaths = prebuiltFiles
    .filter((x) => typeof x !== 'undefined')
    .map(cleanPaths)
})
afterAll(() => {
  delete process.env.CEDAR_CWD
})

test('api files are prebuilt', () => {
  // Builds non-nested functions
  expect(relativePaths).toContain(
    '.cedar/prebuild/api/src/functions/graphql.js',
  )

  // Builds graphql folder
  expect(relativePaths).toContain(
    '.cedar/prebuild/api/src/graphql/todos.sdl.js',
  )

  // Builds nested function
  expect(relativePaths).toContain(
    '.cedar/prebuild/api/src/functions/nested/nested.js',
  )
})

test('api prebuild uses babel config only from the api side root', () => {
  const p = prebuiltFiles.filter((p) => p.endsWith('dog.js')).pop()
  const code = fs.readFileSync(p || '', 'utf-8')
  expect(code).toContain(`import dog from "dog-bless";`)

  // Should ignore root babel config
  expect(code).not.toContain(`import kitty from "kitty-purr"`)
})

test('mock statements also get their import paths rewritten', () => {
  const pathToTest = path.join(getPaths().api.services, 'todos/todos.test.js')

  const code = fs.readFileSync(pathToTest, 'utf-8')

  const defaultOptions = getApiSideDefaultBabelConfig()

  // Step 1: prebuild service/todos.test.js
  const output = babel.transform(code, {
    ...defaultOptions,
    filename: pathToTest,
    cwd: getPaths().api.base,
    // Use Cedar's default (non-Vite) api-side Babel plugins
    plugins: getApiSideBabelPlugins(),
  })?.code

  // Step 2: check that output has correct import statement path
  expect(output).toContain('import dog from "../../lib/dog.js"')
  // Step 3: check that output has correct mock path
  expect(output).toContain('mock("../../lib/dog.js"')
})
