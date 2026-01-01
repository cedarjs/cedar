import path from 'node:path'

import { transformTSToJS } from '../../../lib/index.js'
import { templateForFile } from '../yargsHandlerHelpers.js'

/**
 * Generates the file structure and content for a new package.
 *
 * Creates all necessary files for a package including source files, configuration,
 * README, and optionally test files. Handles both TypeScript and JavaScript generation.
 *
 * @param {Object} options - The file generation options
 * @param {string} options.name - The package name
 * @param {string} options.folderName - The folder name for the package (param-case)
 * @param {string} options.packageName - The full scoped package name (e.g., '@org/package')
 * @param {string} options.fileName - The camelCase file name
 * @param {boolean} [options.typescript] - Whether to generate TypeScript files (defaults to JS if not provided)
 * @param {boolean} [options.tests=true] - Whether to generate test files
 *
 * @returns {Promise<Object>} A promise that resolves to an object mapping file paths to their content
 *
 * @example
 * // Generate TypeScript package files with tests
 * const fileMap = await files({
 *   name: 'MyPackage',
 *   folderName: 'my-package',
 *   packageName: '@myorg/my-package',
 *   fileName: 'myPackage',
 *   typescript: true,
 *   tests: true
 * })
 */
export const files = async ({
  name,
  folderName,
  packageName,
  fileName,
  typescript,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = typescript ? '.ts' : '.js'

  const outputFiles = []

  const indexFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'index.ts.template',
    templateVars: rest,
    outputPath: path.join(folderName, 'src', `index${extension}`),
  })

  const readmeFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'README.md.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'README.md'),
  })

  const packageJsonFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'package.json.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'package.json'),
  })

  const tsconfigFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'tsconfig.json.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'tsconfig.json'),
  })

  outputFiles.push(indexFile)
  outputFiles.push(readmeFile)
  outputFiles.push(packageJsonFile)
  outputFiles.push(tsconfigFile)

  if (generateTests) {
    const testFile = await templateForFile({
      name,
      side: 'packages',
      generator: 'package',
      templatePath: 'test.ts.template',
      templateVars: rest,
      outputPath: path.join(folderName, 'src', `${fileName}.test${extension}`),
    })

    outputFiles.push(testFile)
  }

  return outputFiles.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template =
      typescript || outputPath.endsWith('.md') || outputPath.endsWith('.json')
        ? content
        : await transformTSToJS(outputPath, content)

    return {
      [outputPath]: template,
      ...acc,
    }
  }, Promise.resolve({}))
}
