globalThis.__dirname = __dirname

// Load shared mocks
import '../../../../lib/test.js'

const mockBase = vi.hoisted(() => ({ path: '/path/to/project' }))

const { memfs, ufs, vol } = await vi.hoisted(async () => {
  const { vol, fs: memfs } = await import('memfs')
  const { ufs } = await import('unionfs')
  return { memfs, ufs, vol }
})

vi.mock('../../../../lib/index.js', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof LibIndex>()

  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        base: mockBase.path,
        api: {
          base: path.join(mockBase.path, 'api'),
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

import { dedent } from 'ts-dedent'
import { vi, describe, it, expect, afterEach } from 'vitest'

// @ts-expect-error - No types for JS files
import type * as LibIndex from '../../../../lib/index.js'
// TODO: Separate test file for filesTask.js
// @ts-expect-error - No types for JS files
import * as filesTask from '../filesTask.js'
// @ts-expect-error - No types for JS files
import * as packageHandler from '../packageHandler.js'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs } = await import(
    // @ts-expect-error - No types for JS files
    '../../../../__tests__/ufsFsProxy.js'
  )
  const originalFs = await importOriginal()
  ufs.use(wrapFsForUnionfs(originalFs)).use(memfs as any)
  return {
    ...ufs,
    default: ufs,
  }
})

afterEach(() => {
  mockBase.path = '/path/to/project'
})

describe('packageHandler', () => {
  describe('handler', () => {
    it('throws on package name with two slashes', async () => {
      await expect(() =>
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

  describe('nameVariants', () => {
    it('uses the provided scope name', () => {
      expect(packageHandler.nameVariants('@myOrg/formValidators-pkg')).toEqual({
        name: 'formValidators-pkg',
        folderName: 'form-validators-pkg',
        packageName: '@my-org/form-validators-pkg',
        fileName: 'formValidatorsPkg',
      })
    })

    it('constructs a scope name if none is provided', () => {
      expect(packageHandler.nameVariants('foo')).toEqual({
        name: 'foo',
        folderName: 'foo',
        packageName: '@project/foo',
        fileName: 'foo',
      })
    })

    it('handles camelCase when constructing a scope name', () => {
      mockBase.path = '/path/to/cedarInc'
      expect(packageHandler.nameVariants('MyFoo')).toEqual({
        name: 'MyFoo',
        folderName: 'my-foo',
        packageName: '@cedar-inc/my-foo',
        fileName: 'myFoo',
      })
    })
  })

  describe('files', () => {
    describe('single word package name', () => {
      it('infers package scope from project path', async () => {
        mockBase.path = '/path/to/my-cedar-app'

        const files = await filesTask.files({
          ...packageHandler.nameVariants('foo'),
          typescript: true,
        })

        const fileNames = Object.keys(files)
        expect(fileNames.length).toEqual(5)

        expect(fileNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('README.md'),
            expect.stringContaining('package.json'),
            expect.stringContaining('tsconfig.json'),
            expect.stringContaining('index.ts'),
            expect.stringContaining('foo.test.ts'),
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

        // Both making sure the file is valid json (parsing would fail otherwise)
        // and that the package name is correct
        const packageJson = JSON.parse(files[packageJsonPath])

        expect(packageJson.name).toEqual('@my-cedar-app/foo')
        expect(files[packageJsonPath]).toMatchSnapshot('package.json')
        expect(files[readmePath]).toMatchSnapshot('README.md')
        expect(files[tsconfigJsonPath]).toMatchSnapshot('tsconfig.json')
        expect(files[indexPath]).toMatchSnapshot('index.ts')
        expect(files[testPath]).toMatchSnapshot('foo.test.ts')
      })

      it('uses kebab-case for package scope', async () => {
        // Using both a hyphen and camelCase here on purpose to make sure it's
        // handled correctly
        mockBase.path = '/path/to/my-camelCaseApp'

        const files = await filesTask.files({
          ...packageHandler.nameVariants('foo'),
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
        const files = await filesTask.files({
          ...packageHandler.nameVariants('@my-org/foo'),
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
        mockBase.path = '/path/to/myCamelCaseApp'

        const files = await filesTask.files({
          ...packageHandler.nameVariants('form-validators'),
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

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
      })

      it('creates a multiWord package', async () => {
        mockBase.path = '/path/to/myCamelCaseApp'

        const files = await filesTask.files({
          ...packageHandler.nameVariants('formValidators'),
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

        expect(files[readmePath]).toMatchSnapshot()
        expect(files[indexPath]).toMatchSnapshot()
        expect(files[testPath]).toMatchSnapshot()
      })

      it('uses the provided scope for multiWord-package name', async () => {
        const files = await filesTask.files({
          ...packageHandler.nameVariants('@myOrg/formValidators-pkg'),
          typescript: true,
        })

        const readmePath = path.normalize(
          mockBase.path + '/packages/form-validators-pkg/README.md',
        )
        const packageJsonPath = path.normalize(
          mockBase.path + '/packages/form-validators-pkg/package.json',
        )
        const indexPath = path.normalize(
          mockBase.path + '/packages/form-validators-pkg/src/index.ts',
        )
        const testPath = path.normalize(
          mockBase.path +
            '/packages/form-validators-pkg/src/formValidatorsPkg.test.ts',
        )

        // Both making sure the file is valid json (parsing would fail otherwise)
        // and that the package name is correct
        const packageJson = JSON.parse(files[packageJsonPath])

        expect(packageJson.name).toEqual('@my-org/form-validators-pkg')
        expect(files[indexPath]).toMatch(
          'export function formValidatorsPkg() {',
        )

        expect(files[readmePath]).toMatchSnapshot('readme')
        expect(files[packageJsonPath]).toMatchSnapshot('packageJson')
        expect(files[indexPath]).toMatchSnapshot('index')
        expect(files[testPath]).toMatchSnapshot('test')
      })
    })

    it('returns the corrent files for JS', async () => {
      const jsFiles = await filesTask.files({
        ...packageHandler.nameVariants('Sample'),
      })
      const fileNames = Object.keys(jsFiles)
      expect(fileNames.length).toEqual(5)

      expect(fileNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining('README.md'),
          expect.stringContaining('package.json'),
          // TODO: Make the script output jsconfig.json
          expect.stringContaining('tsconfig.json'),
          expect.stringContaining('index.js'),
          expect.stringContaining('sample.test.js'),
        ]),
      )
    })
  })

  describe('updateTsconfig', () => {
    const tsconfigPath = path.join(mockBase.path, 'api', 'tsconfig.json')

    const tsconfig = `
      {
        "compilerOptions": {
          "noEmit": true,
          "allowJs": true,
          "esModuleInterop": true,
          "target": "ES2023",
          "module": "Node16", // This is the line to update
          "moduleResolution": "Node16",
          "skipLibCheck": false,
          "rootDirs": ["./src", "../.redwood/types/mirror/api/src"],
          "paths": {
            "src/*": ["./src/*", "../.redwood/types/mirror/api/src/*"],
            "types/*": ["./types/*", "../types/*"],
            "@cedarjs/testing": ["../node_modules/@cedarjs/testing/api"]
          },
          "typeRoots": ["../node_modules/@types", "./node_modules/@types"],
          "types": ["jest"],
          // No end-of-line comma here, as you don't need that in tsconfig
          // files. We shouldn't insert one when editing this file
          "jsx": "react-jsx"
        },
        "include": [
          "src",
          "../.redwood/types/includes/all-*",
          "../.redwood/types/includes/api-*",
          "../types"
        ]
      }
    `

    it('updates from Node16 to Node20', async () => {
      vol.fromJSON(
        {
          [tsconfigPath]: tsconfig,
          'redwood.toml': '',
        },
        mockBase.path,
      )

      await packageHandler.updateTsconfig({ skip: () => {} })

      // Comments are valid in tsconfig files, we want to make sure we don't
      // remove those
      expect(fs.readFileSync(tsconfigPath, 'utf8')).toMatch(
        /"module": "Node20", \/\/ This is the line to update/,
      )
      expect(fs.readFileSync(tsconfigPath, 'utf8')).toEqual(
        tsconfig.replace('"module": "Node16",', '"module": "Node20",'),
      )
    })

    it('skips update if "module" is already Node20', async () => {
      const node20tsconfig = tsconfig.replace(
        '"module": "Node16",',
        '"module": "Node20",',
      )
      vol.fromJSON(
        {
          [tsconfigPath]: node20tsconfig,
          'redwood.toml': '',
        },
        mockBase.path,
      )

      const skipFn = vi.fn()
      await packageHandler.updateTsconfig({ skip: skipFn })

      expect(skipFn).toHaveBeenCalled()
      expect(fs.readFileSync(tsconfigPath, 'utf8')).toMatch(
        /"module": "Node20"/,
      )
    })

    it('skips update if "module" is already NodeNext', async () => {
      vol.fromJSON(
        {
          [tsconfigPath]: tsconfig.replace(
            '"module": "Node16",',
            '"module": "NodeNext",',
          ),
          'redwood.toml': '',
        },
        mockBase.path,
      )

      const skipFn = vi.fn()
      await packageHandler.updateTsconfig({ skip: skipFn })

      expect(skipFn).toHaveBeenCalled()
      expect(fs.readFileSync(tsconfigPath, 'utf8')).toMatch(
        /"module": "NodeNext"/,
      )
    })
  })

  describe('addDependencyToPackageJson', () => {
    it('adds dependency to package.json', async () => {
      const apiPackageJsonPath = path.join(mockBase.path, 'api', 'package.json')

      vol.fromJSON(
        {
          [apiPackageJsonPath]: JSON.stringify(
            {
              name: 'api',
              version: '0.0.0',
            },
            null,
            2,
          ),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler.addDependencyToPackageJson(
        { skip: () => {} },
        apiPackageJsonPath,
        '@project/foo',
      )

      const packageJson = JSON.parse(
        fs.readFileSync(apiPackageJsonPath, 'utf8'),
      )
      expect(packageJson.dependencies['@project/foo']).toEqual('workspace:*')
    })

    it('skips when dependency already exists', async () => {
      const apiPackageJsonPath = path.join(mockBase.path, 'api', 'package.json')

      vol.fromJSON(
        {
          [apiPackageJsonPath]: JSON.stringify(
            {
              name: 'api',
              version: '0.0.0',
              dependencies: {
                '@project/foo': 'workspace:*',
              },
            },
            null,
            2,
          ),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      const skipFn = vi.fn()
      await packageHandler.addDependencyToPackageJson(
        { skip: skipFn },
        apiPackageJsonPath,
        '@project/foo',
      )

      expect(skipFn).toHaveBeenCalled()
    })
  })

  describe('updateWorkspaceTsconfigReferences', () => {
    it('adds reference to api tsconfig', async () => {
      const tsconfigPath = path.join(mockBase.path, 'api', 'tsconfig.json')
      const tsconfig = {
        references: [{ path: 'packages/existing' }],
        files: [],
      }

      vol.fromJSON(
        {
          [tsconfigPath]: JSON.stringify(tsconfig, null, 2),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const updated = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'))
      const expectedPath = path
        .relative(
          path.join(mockBase.path, 'api'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      expect(updated.references).toEqual(
        expect.arrayContaining([{ path: expectedPath }]),
      )
    })

    it('adds reference to api tsconfig when no references array exists', async () => {
      const tsconfigPath = path.join(mockBase.path, 'api', 'tsconfig.json')
      const tsconfig = {
        files: [],
      }

      vol.fromJSON(
        {
          [tsconfigPath]: JSON.stringify(tsconfig, null, 2),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const updated = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'))
      const expectedPath = path
        .relative(
          path.join(mockBase.path, 'api'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      expect(updated.references).toEqual(
        expect.arrayContaining([{ path: expectedPath }]),
      )
    })

    it('skips updating tsconfig when reference exists', async () => {
      const tsconfigPath = path.join(mockBase.path, 'api', 'tsconfig.json')
      const existingPath = path
        .relative(
          path.join(mockBase.path, 'api'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      const tsconfig = {
        references: [{ path: existingPath }],
        files: [],
      }

      vol.fromJSON(
        {
          [tsconfigPath]: JSON.stringify(tsconfig, null, 2),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      const before = fs.readFileSync(tsconfigPath, 'utf8')

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const after = fs.readFileSync(tsconfigPath, 'utf8')
      expect(after).toEqual(before)
    })

    it('adds reference to api tsconfig when tsconfig contains comments and trailing commas', async () => {
      const tsconfigPath = path.join(mockBase.path, 'api', 'tsconfig.json')
      const tsconfigText = dedent`{
        // existing comment
        "references": [
          { "path": "packages/existing", }, // trailing comma and comment
        ], // trailing comma
        "files": [], // trailing comma
      }`

      vol.fromJSON(
        {
          [tsconfigPath]: tsconfigText,
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const updatedText = fs.readFileSync(tsconfigPath, 'utf8')
      const expectedPath = path
        .relative(
          path.join(mockBase.path, 'api'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      expect(updatedText).toContain(expectedPath)
    })

    it('adds reference to scripts tsconfig when tsconfig contains comments and trailing commas', async () => {
      const scriptsTsconfigPath = path.join(
        mockBase.path,
        'scripts',
        'tsconfig.json',
      )
      const tsconfigText = dedent`{
        // comment
        "references": [
          { "path": "packages/existing", },
        ],
        "files": [],
      }`

      vol.fromJSON(
        {
          [scriptsTsconfigPath]: tsconfigText,
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const updatedText = fs.readFileSync(scriptsTsconfigPath, 'utf8')
      const expectedPath = path
        .relative(
          path.join(mockBase.path, 'scripts'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      expect(updatedText).toContain(expectedPath)
    })

    it('adds reference to scripts tsconfig when workspace selected', async () => {
      const scriptsTsconfigPath = path.join(
        mockBase.path,
        'scripts',
        'tsconfig.json',
      )
      const tsconfig = {
        references: [{ path: 'packages/existing' }],
        files: [],
      }

      vol.fromJSON(
        {
          [scriptsTsconfigPath]: JSON.stringify(tsconfig, null, 2),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const updated = JSON.parse(fs.readFileSync(scriptsTsconfigPath, 'utf8'))
      const expectedPath = path
        .relative(
          path.join(mockBase.path, 'scripts'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      expect(updated.references).toEqual(
        expect.arrayContaining([{ path: expectedPath }]),
      )
    })

    it('skips updating scripts tsconfig when reference exists', async () => {
      const scriptsTsconfigPath = path.join(
        mockBase.path,
        'scripts',
        'tsconfig.json',
      )
      const existingPath = path
        .relative(
          path.join(mockBase.path, 'scripts'),
          path.join(mockBase.path, 'packages', 'newpkg'),
        )
        .split(path.sep)
        .join('/')
      const tsconfig = {
        references: [{ path: existingPath }],
        files: [],
      }

      vol.fromJSON(
        {
          [scriptsTsconfigPath]: JSON.stringify(tsconfig, null, 2),
          'cedar.toml': '',
        },
        mockBase.path,
      )

      const before = fs.readFileSync(scriptsTsconfigPath, 'utf8')

      await packageHandler
        .updateWorkspaceTsconfigReferences({ skip: () => {} }, 'newpkg', 'api')
        .run()

      const after = fs.readFileSync(scriptsTsconfigPath, 'utf8')
      expect(after).toEqual(before)
    })

    it('parses workspace flag (valid values and case-insensitive)', () => {
      expect(packageHandler.parseWorkspaceFlag('API')).toEqual('api')
      expect(packageHandler.parseWorkspaceFlag('both')).toEqual('both')
      expect(packageHandler.parseWorkspaceFlag(undefined)).toBeUndefined()
    })

    it('throws for invalid workspace flag values', () => {
      expect(() => packageHandler.parseWorkspaceFlag('invalid')).toThrowError(
        /Invalid workspace value/,
      )
    })
  })

  describe('updateGitignore', () => {
    const gitignorePath = path.join(mockBase.path, '.gitignore')

    const gitignore = dedent`
      .idea
      .DS_Store
      .env*
      !.env.example
      !.env.defaults
      .netlify
      .redwood/*
      !.redwood/README.md
      dev.db*
      dist
      dist-babel
      node_modules
      yarn-error.log
      web/public/mockServiceWorker.js
      web/types/graphql.d.ts
      api/types/graphql.d.ts
      api/src/lib/generateGraphiQLHeader.*
      .pnp.*
      .yarn/*
      !.yarn/patches
      !.yarn/plugins
      !.yarn/releases
      !.yarn/sdks
      !.yarn/versions
    `

    const gitignoreWithTsBuildInfo = dedent`
      .idea
      .DS_Store
      .env*
      !.env.example
      !.env.defaults
      .netlify
      .redwood/*
      !.redwood/README.md
      dev.db*
      dist
      dist-babel
      node_modules
      tsconfig.tsbuildinfo
      yarn-error.log
      web/public/mockServiceWorker.js
      web/types/graphql.d.ts
      api/types/graphql.d.ts
      api/src/lib/generateGraphiQLHeader.*
      .pnp.*
      .yarn/*
      !.yarn/patches
      !.yarn/plugins
      !.yarn/releases
      !.yarn/sdks
      !.yarn/versions
    `

    it('inserts tsconfig.tsbuildinfo right before yarn-error.log', async () => {
      vol.fromJSON(
        {
          [gitignorePath]: gitignore,
          'redwood.toml': '',
        },
        mockBase.path,
      )

      await packageHandler.updateGitignore({ skip: () => {} })

      expect(fs.readFileSync(gitignorePath, 'utf8')).toEqual(
        gitignoreWithTsBuildInfo,
      )
    })

    it('inserts tsconfig.tsbuildinfo at the end if no yarn-error.log line is found', async () => {
      vol.fromJSON(
        {
          [gitignorePath]: gitignore.replace('yarn-error.log\n', ''),
          'redwood.toml': '',
        },
        mockBase.path,
      )

      await packageHandler.updateGitignore({ skip: () => {} })

      expect(fs.readFileSync(gitignorePath, 'utf8')).toEqual(
        dedent`
          .idea
          .DS_Store
          .env*
          !.env.example
          !.env.defaults
          .netlify
          .redwood/*
          !.redwood/README.md
          dev.db*
          dist
          dist-babel
          node_modules
          web/public/mockServiceWorker.js
          web/types/graphql.d.ts
          api/types/graphql.d.ts
          api/src/lib/generateGraphiQLHeader.*
          .pnp.*
          .yarn/*
          !.yarn/patches
          !.yarn/plugins
          !.yarn/releases
          !.yarn/sdks
          !.yarn/versions
          tsconfig.tsbuildinfo
        `,
      )
    })

    it('skips update if "tsconfig.tsbuildinfo" is already present', async () => {
      vol.fromJSON(
        {
          [gitignorePath]: gitignoreWithTsBuildInfo,
          'redwood.toml': '',
        },
        mockBase.path,
      )

      const skipFn = vi.fn()
      await packageHandler.updateGitignore({ skip: skipFn })

      expect(skipFn).toHaveBeenCalled()
      expect(fs.readFileSync(gitignorePath, 'utf8')).toEqual(
        gitignoreWithTsBuildInfo,
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
