globalThis.__dirname = __dirname

// Load shared mocks
import '../../../../lib/test'

import path from 'path'

import { describe, it, expect } from 'vitest'

// @ts-expect-error - Importing a JS file
import * as packageHandler from '../packageHandler.js'

describe('packageHandler', () => {
  describe('handler', () => {
    it('throws on package name with two slashes', async () => {
      expect(() =>
        packageHandler.handler({ name: 'package//name' }),
      ).rejects.toThrowError(
        'Invalid package name "package//name". Package names can have at most one slash.',
      )

      await expect(() =>
        packageHandler.handler({ name: '@test-org/package/name' }),
      ).rejects.toThrowError(
        'Invalid package name "@test-org/package/name". Package names can have at most one slash.',
      )
    })
  })

  describe('files', () => {
    const packagesPath = '/path/to/project/packages'

    describe('single word package names', async () => {
      const files = await packageHandler.files({
        name: '@my-org/foo',
        typescript: true,
      })

      it('creates a single word package', () => {
        const fileNames = Object.keys(files)
        expect(fileNames.length).toEqual(4)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('README.md'),
            expect.stringContaining('index.ts'),
            expect.stringContaining('foo.test.ts'),
            expect.stringContaining('foo.scenarios.ts'),
          ]),
        )

        const readmePath = path.normalize(packagesPath + '/foo/README.md')
        const indexPath = path.normalize(packagesPath + '/foo/src/index.ts')
        const testPath = path.normalize(packagesPath + '/foo/src/foo.test.ts')
        const scenariosPath = path.normalize(
          packagesPath + '/foo/src/foo.scenarios.ts',
        )

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
        expect(files[scenariosPath]).toMatchSnapshot()
      })
    })

    // I had to decide if I wanted the folder name for multi-word packages to be
    // hyphenated (kebab-case) or camelCase. I decided to use kebab-case because
    // it matches what the package name is. So, just like we use PascalCase for
    // folder names for React components, we use kebab-case for folder names for
    // packages.
    describe('multi-word package names', () => {
      it('creates a multi-word package', async () => {
        const files = await packageHandler.files({
          name: '@my-org/form-validators',
          typescript: true,
        })

        const readmePath = path.normalize(
          packagesPath + '/form-validators/README.md',
        )
        const indexPath = path.normalize(
          packagesPath + '/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.test.ts',
        )
        const scenariosPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
        expect(files[scenariosPath]).toMatchSnapshot()
      })

      it('creates a multiWord package', async () => {
        const files = await packageHandler.files({
          name: '@my-org/formValidators',
          typescript: true,
        })

        const readmePath = path.normalize(
          packagesPath + '/form-validators/README.md',
        )
        const indexPath = path.normalize(
          packagesPath + '/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.test.ts',
        )
        const scenarioPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
        expect(files[scenarioPath]).toMatchSnapshot()
      })
    })

    describe('generation of js files', async () => {
      const jsFiles = await packageHandler.files({ name: 'Sample' })

      it('returns tests, scenario and main package file for JS', () => {
        const fileNames = Object.keys(jsFiles)
        expect(fileNames.length).toEqual(4)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('README.md'),
            expect.stringContaining('index.js'),
            expect.stringContaining('sample.test.js'),
            expect.stringContaining('sample.scenarios.js'),
          ]),
        )
      })
    })
  })
})
