import fs from 'node:fs'
import path from 'node:path'

import fg from 'fast-glob'
import { expect } from 'vitest'

import runTransform from '../lib/runTransform'

import { createProjectMock } from './index'

type Options = {
  removeWhitespace?: boolean
  targetPathsGlob?: string
  /**
   * Use this option, when you want to run a codemod that uses jscodeshift
   * as well as modifies file names. e.g. convertJsToJsx
   */
  useJsCodeshift?: boolean
}

type MatchFolderTransformFunction = (
  transformFunctionOrName: (() => any) | string,
  fixtureName?: string,
  options?: Options,
) => Promise<void>

export const matchFolderTransform: MatchFolderTransformFunction = async (
  transformFunctionOrName,
  fixtureName,
  {
    removeWhitespace = false,
    targetPathsGlob = '**/*',
    useJsCodeshift = false,
  } = {},
) => {
  const tempDir = createProjectMock()

  // Override paths used in getPaths() utility func
  process.env.CEDAR_CWD = tempDir

  // Looks up the path of the caller
  const testPath = expect.getState().testPath

  if (!testPath) {
    throw new Error('Could not find test path')
  }

  const fixtureFolder = path.join(
    testPath,
    '../../__testfixtures__',
    fixtureName || '',
  )

  const fixtureInputDir = path.join(fixtureFolder, 'input')
  const fixtureOutputDir = path.join(fixtureFolder, 'output')

  // Step 1: Copy files recursively from fixture folder to temp
  fs.cpSync(fixtureInputDir, tempDir, {
    force: true,
    recursive: true,
  })

  const GLOB_CONFIG = {
    absolute: false,
    dot: true,
    ignore: ['cedar.toml', 'redwood.toml', '**/*.DS_Store'], // ignore the fake config file added for getPaths
  }

  // Step 2: Run transform against temp dir
  if (useJsCodeshift) {
    if (typeof transformFunctionOrName !== 'string') {
      throw new Error(
        'When running matchFolderTransform with useJsCodeshift, transformFunction must be a string (file name of jscodeshift transform)',
      )
    }
    const transformName = transformFunctionOrName
    const transformPath = require.resolve(
      path.join(testPath, '../../', `${transformName}.ts`),
    )

    const targetPaths = fg.sync(targetPathsGlob, {
      ...GLOB_CONFIG,
      cwd: tempDir,
    })

    // So that the transform can use getPaths() utility func
    // This is used inside the runTransform function
    process.env.CEDAR_CWD = tempDir

    await runTransform({
      transformPath,
      targetPaths: targetPaths.map((p) => path.join(tempDir, p)),
    })
  } else {
    if (typeof transformFunctionOrName !== 'function') {
      throw new Error(
        'transformFunction must be a function, if useJsCodeshift set to false',
      )
    }
    const transformFunction = transformFunctionOrName
    await transformFunction()
  }

  const transformedPaths = fg.sync(targetPathsGlob, {
    ...GLOB_CONFIG,
    cwd: tempDir,
  })

  const expectedPaths = fg.sync(targetPathsGlob, {
    ...GLOB_CONFIG,
    cwd: fixtureOutputDir,
  })

  // Step 3: Check output paths
  expect(transformedPaths).toEqual(expectedPaths)

  // Step 4: Check contents of each file
  transformedPaths.forEach((transformedFile) => {
    const actualPath = path.join(tempDir, transformedFile)
    const expectedPath = path.join(fixtureOutputDir, transformedFile)

    expect(actualPath).toMatchFileContents(expectedPath, { removeWhitespace })
  })

  delete process.env.CEDAR_CWD

  // Not awaiting - it'll be cleaned up eventually. Also, I was getting errors
  // like these on Windows, so I'm just catching and ignoring them.
  // Error: EBUSY: resource busy or locked, rmdir 'C:\Users\RUNNER~1\AppData\Local\Temp\cedar-test-UhbKQX'
  fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
}
