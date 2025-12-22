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
    const packagesPath = '/path/to/project/api/src/packages'

    describe('single word package names', async () => {
      const files = await packageHandler.files({ name: '@my-org/foo' })

      it('creates a single word package', () => {
        expect(
          files[path.normalize(packagesPath + '/foo/src/index.ts')],
        ).toMatchSnapshot('Package index')

        expect(
          files[path.normalize(packagesPath + '/foo/src/README.md')],
        ).toMatchSnapshot('README snapshot')

        expect(
          files[path.normalize(packagesPath + '/foo/src/foo.test.ts')],
        ).toMatchSnapshot('Test snapshot')

        expect(
          files[path.normalize(packagesPath + '/foo/src/foo.scenarios.ts')],
        ).toMatchSnapshot('Scenario snapshot')
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
        })

        const indexPath = path.normalize(
          packagesPath + '/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.test.ts',
        )
        const scenarioPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[indexPath]).toMatchSnapshot('Package index')
        expect(files[testPath]).toMatchSnapshot('Test snapshot')
        expect(files[scenarioPath]).toMatchSnapshot('Scenario snapshot')
      })

      it('creates a multiWord package', async () => {
        const files = await packageHandler.files({
          name: '@my-org/formValidators',
        })

        const indexPath = path.normalize(
          packagesPath + '/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.test.ts',
        )
        const scenarioPath = path.normalize(
          packagesPath + '/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[indexPath]).toMatchSnapshot('Package index')
        expect(files[testPath]).toMatchSnapshot('Test snapshot')
        expect(files[scenarioPath]).toMatchSnapshot('Scenario snapshot')
      })
    })

    describe('generation of js files', async () => {
      const jsFiles = await packageHandler.files({
        name: 'Sample',
        typescript: false,
      })

      it('returns tests, scenario and main package file for JS', () => {
        const fileNames = Object.keys(jsFiles)
        expect(fileNames.length).toEqual(3)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('index.js'),
            expect.stringContaining('sample.test.js'),
            expect.stringContaining('sample.scenarios.js'),
          ]),
        )
      })
    })
  })
})
