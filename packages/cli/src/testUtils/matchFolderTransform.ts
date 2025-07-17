import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import fg from 'fast-glob'
import fse from 'fs-extra'
import { expect } from 'vitest'

import runTransform from '../testLib/runTransform.js'

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

const require = createRequire(import.meta.url)

// Cache for compiled formatCode function
let formatCodeCache: ((code: string) => Promise<string>) | null = null

async function getFormatCode() {
  if (!formatCodeCache) {
    const { format } = await import('prettier')
    const parserBabel = await import('prettier/parser-babel')

    formatCodeCache = async (code: string) => {
      return format(code, {
        parser: 'babel-ts',
        // @ts-expect-error - TS is picking up @types/babel, which is outdated.
        // We have it because babel-plugin-tester pulls it in
        plugins: [parserBabel.default],
      })
    }
  }
  return formatCodeCache
}

async function copyFiles(
  sourceDir: string,
  targetDir: string,
  targetGlob = '**/*',
): Promise<void> {
  const IGNORE_PATTERNS = ['redwood.toml', '**/*.DS_Store']

  // Get only files that match the target glob to avoid unnecessary copying
  const filesToCopy = fg.sync(targetGlob, {
    cwd: sourceDir,
    absolute: false,
    dot: true,
    onlyFiles: true,
    ignore: IGNORE_PATTERNS,
  })

  // Use parallel copying for better performance
  const copyPromises = filesToCopy.map((file) => {
    const sourcePath = path.join(sourceDir, file)
    const targetPath = path.join(targetDir, file)

    // Ensure directory exists
    fse.ensureDirSync(path.dirname(targetPath))

    // Copy file
    return fse.copy(sourcePath, targetPath, { overwrite: true })
  })

  // Wait for all copies to complete
  await Promise.all(copyPromises)
}

// Optimized content comparison that handles formatting efficiently
async function compareFileContents(
  actualPath: string,
  expectedPath: string,
  removeWhitespace = false,
  testPath: string,
): Promise<void> {
  let actualContent = await fse.readFile(actualPath, 'utf-8')
  let expectedContent = await fse.readFile(expectedPath, 'utf-8')

  if (removeWhitespace) {
    actualContent = actualContent.replace(/\s/g, '')
    expectedContent = expectedContent.replace(/\s/g, '')
  }

  const formatCode = await getFormatCode()

  try {
    const formattedActual = await formatCode(actualContent)
    const formattedExpected = await formatCode(expectedContent)

    expect(formattedActual).toEqual(formattedExpected)
  } catch (e) {
    const relativePath = path.relative(
      path.join(testPath, '../..'),
      expectedPath,
    )
    throw new Error(
      `${e}\nFile contents do not match for fixture at: \n ${relativePath}`,
    )
  }
}

export const matchFolderTransform: MatchFolderTransformFunction = async (
  transformFunctionOrName,
  fixtureName,
  {
    removeWhitespace = false,
    targetPathsGlob = '**/*',
    useJsCodeshift = false,
  } = {},
) => {
  // Use OS temp directory with unique suffix for better performance
  const tempDir = path.join(
    tmpdir(),
    `cedar-test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  )

  const originalRwjsCwd = process.env.RWJS_CWD
  const originalCwd = process.cwd()
  process.env.RWJS_CWD = tempDir

  try {
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

    await fse.ensureDir(tempDir)
    await copyFiles(fixtureInputDir, tempDir, targetPathsGlob)

    const GLOB_CONFIG = {
      absolute: false,
      dot: true,
      ignore: ['redwood.toml', '**/*.DS_Store'],
      onlyFiles: true,
    }

    // Run transform
    if (useJsCodeshift) {
      if (typeof transformFunctionOrName !== 'string') {
        throw new Error(
          'When running matchFolderTransform with useJsCodeshift, ' +
            'transformFunction must be a string (file name of jscodeshift ' +
            'transform)',
        )
      }

      const transformName = transformFunctionOrName
      const transformPath = require.resolve(
        path.join(testPath, '../../', transformName + '.ts'),
      )

      const targetPaths = await fg(targetPathsGlob, {
        ...GLOB_CONFIG,
        cwd: tempDir,
      })

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

    // Get file lists for comparison
    const [transformedPaths, expectedPaths] = await Promise.all([
      fg(targetPathsGlob, {
        ...GLOB_CONFIG,
        cwd: tempDir,
      }),
      fg(targetPathsGlob, {
        ...GLOB_CONFIG,
        cwd: fixtureOutputDir,
      }),
    ])

    // Compare paths
    expect(transformedPaths.sort()).toEqual(expectedPaths.sort())

    const contentComparisons = transformedPaths.map(async (transformedFile) => {
      const actualPath = path.join(tempDir, transformedFile)
      const expectedPath = path.join(fixtureOutputDir, transformedFile)

      return compareFileContents(
        actualPath,
        expectedPath,
        removeWhitespace,
        testPath,
      )
    })

    await Promise.all(contentComparisons)
  } finally {
    // Restore environment
    if (originalRwjsCwd) {
      process.env.RWJS_CWD = originalRwjsCwd
    } else {
      delete process.env.RWJS_CWD
    }
    process.chdir(originalCwd)

    // Clean up temp directory asynchronously (don't wait for it)
    fse.remove(tempDir).catch(() => {
      // Ignore cleanup errors
    })
  }
}
