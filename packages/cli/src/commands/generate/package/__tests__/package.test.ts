globalThis.__dirname = __dirname

// Load shared mocks
import '../../../../lib/test.js'

const mockBase = vi.hoisted(() => ({ path: '/path/to/project' }))

vi.mock('../../../../lib/index.js', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof LibIndex>()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        base: mockBase.path,
        api: {
          prismaConfig: path.join(
            // Current test folder
            globalThis.__dirname,
            'fixtures',
            'prisma.config.cjs',
          ),
          dataMigrations: path.join(mockBase.path, 'api/dataMigrations'),
          src: path.join(mockBase.path, 'api/src'),
          jobs: path.join(mockBase.path, 'api/src/jobs'),
          services: path.join(mockBase.path, 'api/src/services'),
          directives: path.join(mockBase.path, 'api/src/directives'),
          graphql: path.join(mockBase.path, 'api/src/graphql'),
          functions: path.join(mockBase.path, 'api/src/functions'),
        },
        web: {
          base: path.join(mockBase.path, 'web'),
          config: path.join(mockBase.path, 'web/config'),
          src: path.join(mockBase.path, 'web/src'),
          routes: path.join(mockBase.path, 'web/src/Routes.js'),
          components: path.join(mockBase.path, 'web/src/components'),
          layouts: path.join(mockBase.path, 'web/src/layouts'),
          pages: path.join(mockBase.path, 'web/src/pages'),
          app: path.join(mockBase.path, 'web/src/App.js'),
        },
        scripts: path.join(mockBase.path, 'scripts'),
        packages: path.join(mockBase.path, 'packages'),
        generatorTemplates: path.join(mockBase.path, 'generatorTemplates'),
        generated: {
          base: path.join(mockBase.path, '.redwood'),
          schema: path.join(mockBase.path, '.redwood/schema.graphql'),
          types: {
            includes: path.join(mockBase.path, '.redwood/types/includes'),
            mirror: path.join(mockBase.path, '.redwood/types/mirror'),
          },
        },
      }
    },
  }
})

import fs from 'node:fs'
import path from 'node:path'

import { vi, describe, it, expect } from 'vitest'

// @ts-expect-error - Importing a JS file
import type * as LibIndex from '../../../../lib/index.js'
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
    describe('single word package name', () => {
      it('infers package scope from project path', async () => {
        console.log('executing first test')
        mockBase.path = '/path/to/my-cedar-app'

        console.log('calling first method that should call out to getPaths()')
        const files = await packageHandler.files({
          name: 'foo',
          typescript: true,
        })

        const fileNames = Object.keys(files)
        expect(fileNames.length).toEqual(6)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('README.md'),
            expect.stringContaining('package.json'),
            expect.stringContaining('tsconfig.json'),
            expect.stringContaining('index.ts'),
            expect.stringContaining('foo.test.ts'),
            expect.stringContaining('foo.scenarios.ts'),
          ]),
        )

        const packageJsonPath = path.normalize(
          mockBase.path + '/packages/foo/package.json',
        )
        const readmePath = path.normalize(
          mockBase.path + '/packages/foo/README.md',
        )
        const tsconfigJsonPath = path.normalize(
          mockBase.path + '/packages/foo/tsconfig.json',
        )
        const indexPath = path.normalize(
          mockBase.path + '/packages/foo/src/index.ts',
        )
        const testPath = path.normalize(
          mockBase.path + '/packages/foo/src/foo.test.ts',
        )
        const scenariosPath = path.normalize(
          mockBase.path + '/packages/foo/src/foo.scenarios.ts',
        )

        // Both making sure the file is valid json (parsing would fail otherwise)
        // and that the package name is correct
        const packageJson = JSON.parse(files[packageJsonPath])

        expect(packageJson.name).toEqual('@my-cedar-app/foo')
        expect(files[packageJsonPath]).toMatchSnapshot('package.json')
        expect(files[readmePath]).toMatchSnapshot('README.md')
        expect(files[tsconfigJsonPath]).toMatchSnapshot('tsconfig.json')
        expect(files[indexPath]).toMatchSnapshot('index.ts')
        expect(files[testPath]).toMatchSnapshot('foo.test.ts')
        expect(files[scenariosPath]).toMatchSnapshot('foo.scenarios.ts')
      })

      it('uses kebab-case for package scope', async () => {
        // Using both a hyphen and camelCase here on purpose to make sure it's
        // handled correctly
        mockBase.path = '/path/to/my-camelCaseApp'

        const files = await packageHandler.files({
          name: 'foo',
          typescript: true,
        })

        const packageJsonPath = path.normalize(
          mockBase.path + '/packages/foo/package.json',
        )

        // Both making sure the file is valid json (parsing would fail otherwise)
        // and that the package name is correct
        const packageJson = JSON.parse(files[packageJsonPath])

        expect(packageJson.name).toEqual('@my-camel-case-app/foo')
      })

      it('uses the provided package scope name', async () => {
        const files = await packageHandler.files({
          name: '@my-org/foo',
          typescript: true,
        })

        const packageJsonPath = path.normalize(
          mockBase.path + '/packages/foo/package.json',
        )

        // Both making sure the file is valid json (parsing would fail otherwise)
        // and that the package name is correct
        const packageJson = JSON.parse(files[packageJsonPath])

        expect(packageJson.name).toEqual('@my-org/foo')
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
          name: 'form-validators',
          typescript: true,
        })

        const readmePath = path.normalize(
          mockBase.path + '/packages/form-validators/README.md',
        )
        const indexPath = path.normalize(
          mockBase.path + '/packages/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          mockBase.path +
            '/packages/form-validators/src/formValidators.test.ts',
        )
        const scenariosPath = path.normalize(
          mockBase.path +
            '/packages/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
        expect(files[scenariosPath]).toMatchSnapshot()
      })

      it('creates a multiWord package', async () => {
        mockBase.path = '/path/to/myCamelCaseApp'

        const files = await packageHandler.files({
          name: 'formValidators',
          typescript: true,
        })

        const readmePath = path.normalize(
          mockBase.path + '/packages/form-validators/README.md',
        )
        const indexPath = path.normalize(
          mockBase.path + '/packages/form-validators/src/index.ts',
        )
        const testPath = path.normalize(
          mockBase.path +
            '/packages/form-validators/src/formValidators.test.ts',
        )
        const scenarioPath = path.normalize(
          mockBase.path +
            '/packages/form-validators/src/formValidators.scenarios.ts',
        )

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
        expect(files[scenarioPath]).toMatchSnapshot()
      })
    })

    it('returns tests, scenario and main package file for JS', async () => {
      const jsFiles = await packageHandler.files({ name: 'Sample' })
      const fileNames = Object.keys(jsFiles)
      expect(fileNames.length).toEqual(6)

      expect(fileNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining('README.md'),
          expect.stringContaining('package.json'),
          // TODO: Make the script output jsconfig.json
          expect.stringContaining('tsconfig.json'),
          expect.stringContaining('index.js'),
          expect.stringContaining('sample.test.js'),
          expect.stringContaining('sample.scenarios.js'),
        ]),
      )
    })
  })

  // This test is to make sure we don't forget to update the template when we
  // upgrade TypeScript
  it('has the correct version of TypeScript in the generated package', () => {
    const cedarPackageJsonPath = path.normalize(
      path.join(__dirname, ...Array(7).fill('..'), 'package.json'),
    )
    const packageJson = JSON.parse(
      fs.readFileSync(cedarPackageJsonPath, 'utf8'),
    )

    const packageJsonTemplatePath = path.join(
      __dirname,
      '..',
      'templates',
      'package.json.template',
    )
    const packageJsonTemplate = fs.readFileSync(packageJsonTemplatePath, 'utf8')

    expect(packageJsonTemplate).toContain(
      `"typescript": "${packageJson.devDependencies.typescript}"`,
    )
  })
})
