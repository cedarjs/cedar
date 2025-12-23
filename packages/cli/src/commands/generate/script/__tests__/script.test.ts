globalThis.__dirname = __dirname
// Load shared mocks
import '../../../../lib/test'

import fs from 'node:fs'
import path from 'node:path'

import fse from 'fs-extra'
import { vi, test, expect, describe, beforeAll, afterAll } from 'vitest'
import yargs from 'yargs'

// @ts-expect-error - js file
import * as script from '../script.js'
// @ts-expect-error - js file
import * as scriptHandler from '../scriptHandler.js'

const PROJECT_PATH = path.normalize('/path/to/project')

test('creates a JavaScript function to execute', async () => {
  const output = await scriptHandler.files({
    name: 'scriptyMcScript',
    typescript: false,
  })

  const expectedOutputPath = path.normalize(
    path.join(PROJECT_PATH, 'scripts', 'scriptyMcScript.js'),
  )

  expect(Object.keys(output)).toContainEqual(expectedOutputPath)
  expect(output[expectedOutputPath]).toMatchSnapshot()
})

describe('custom template', () => {
  beforeAll(() => {
    vi.mock('../../../../lib/index.js', async (importOriginal) => {
      const originalLibIndex = await importOriginal<any>()

      return {
        ...originalLibIndex,
        getPaths: () => {
          const BASE_PATH = '/path/to/project'

          return {
            base: BASE_PATH,
            generatorTemplates: path.join(BASE_PATH, 'generatorTemplates'),
            scripts: path.join(BASE_PATH, 'scripts'),
          }
        },
      }
    })

    const scriptTemplatePath = path.join(
      PROJECT_PATH,
      'generatorTemplates',
      'scripts',
      'script',
      'script.ts.template',
    )
    const tsconfigTemplatePath = path.join(
      PROJECT_PATH,
      'generatorTemplates',
      'scripts',
      'script',
      'tsconfig.json.template',
    )

    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
      const normalizedPath = path.normalize(filePath.toString())

      if (normalizedPath === scriptTemplatePath) {
        return (
          'export default async ({ args }) => {\n' +
          "  console.log('Custom script template')\n" +
          '}'
        )
      } else if (normalizedPath === tsconfigTemplatePath) {
        return (
          '{\n' +
          '  "compilerOptions": {\n' +
          '    "target": "ES2020",\n' +
          '    "module": "CommonJS",\n' +
          '    "strict": true,\n' +
          '    "esModuleInterop": true,\n' +
          '    "skipLibCheck": true,\n' +
          '    "forceConsistentCasingInFileNames": true\n' +
          '  }\n' +
          '}'
        )
      }

      return ''
    })

    vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
      if (path.toString().endsWith('tsconfig.json')) {
        return false
      }

      return true
    })
    vi.spyOn(fse, 'existsSync').mockReturnValue(true)
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  test('uses a custom template if one is present', async () => {
    const output = await scriptHandler.files({
      name: 'scriptyMcScript',
      typescript: true,
    })

    const expectedScriptOutputPath = path.normalize(
      path.join(PROJECT_PATH, 'scripts', 'scriptyMcScript.ts'),
    )
    const expectedTsconfigOutputPath = path.normalize(
      path.join(PROJECT_PATH, 'scripts', 'tsconfig.json'),
    )

    expect(output[expectedScriptOutputPath]).toContain('Custom script template')
    expect(output[expectedTsconfigOutputPath]).toContain(
      'forceConsistentCasingInFileNames',
    )
  })
})

test('creates a TypeScript function to execute', async () => {
  const output = await scriptHandler.files({
    name: 'typescriptyTypescript',
    typescript: true,
  })

  const expectedOutputPath = path.normalize(
    path.join(PROJECT_PATH, 'scripts', 'typescriptyTypescript.ts'),
  )
  const tsconfigPath = path.normalize(
    path.join(PROJECT_PATH, 'scripts', 'tsconfig.json'),
  )

  const outputFilePaths = Object.keys(output)

  expect(outputFilePaths).toContainEqual(expectedOutputPath)
  expect(output[expectedOutputPath]).toMatchSnapshot()

  // Should generate tsconfig, because it's not present
  expect(outputFilePaths).toContainEqual(tsconfigPath)
})

test('keeps Script in name', async () => {
  const isPromiseLike = <T>(obj: unknown): obj is Promise<T> => {
    if (!!obj && typeof obj === 'object') {
      if ('then' in obj) {
        return true
      }
    }

    return false
  }

  const argv = yargs()
    .command('script <name>', false, script.builder)
    .parse('script BazingaScript')

  const name = isPromiseLike(argv) ? (await argv).name : argv.name

  expect(name).toEqual('BazingaScript')
})
