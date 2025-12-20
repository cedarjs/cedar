globalThis.__dirname = __dirname
// Load shared mocks
import '../../../../lib/test'

import path from 'path'

import { describe, it, expect } from 'vitest'

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
    describe('Single word default files', async () => {
      const files = await packageHandler.files({ name: '@my-org/foo' })

      it.only('creates a single word package', () => {
        const packagesPath = '/path/to/project/api/src/packages'
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

    describe('multi-word files', () => {
      it('creates a multi word function file', async () => {
        const multiWordDefaultFiles = await packageHandler.files({
          name: 'send-mail',
          queueName: 'default',
          tests: false,
          typescript: true,
        })

        expect(
          multiWordDefaultFiles[
            path.normalize(
              '/path/to/project/api/src/functions/SendMailJob/SendMailJob.js',
            )
          ],
        ).toMatchSnapshot()
      })
    })

    describe('generation of js files', async () => {
      const jsFiles = await packageHandler.files({
        name: 'Sample',
        queueName: 'default',
        tests: true,
        typescript: false,
      })

      it('returns tests, scenario and job file for JS', () => {
        const fileNames = Object.keys(jsFiles)
        expect(fileNames.length).toEqual(3)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('SampleJob.js'),
            expect.stringContaining('SampleJob.test.js'),
            expect.stringContaining('SampleJob.scenarios.js'),
          ]),
        )
      })
    })
  })
})
