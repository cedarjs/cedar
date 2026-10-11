globalThis.__dirname = __dirname

import fs from 'node:fs'
import type * as NodeFs from 'node:fs'
import path from 'path'

import { vol } from 'memfs'
import { vi, test, describe, beforeEach, afterEach, expect } from 'vitest'

import '../../../../lib/test'

import type * as Lib from '../../../../lib/index.js'
import { getPaths, getDefaultArgs } from '../../../../lib/index.js'
import type * as SchemaHelpers from '../../../../lib/schemaHelpers.js'
import { files } from '../../../generate/scaffold/scaffoldHandler.js'
import { getYargsDefaults as getDefaults } from '../../../generate/yargsCommandHelpers.js'
import { customOrDefaultTemplatePath } from '../../../generate/yargsHandlerHelpers.js'
import { tasks } from '../scaffoldHandler.js'

vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))
vi.mock('execa')

vi.mock('../../../../lib', async (importOriginal) => {
  const originalLib = await importOriginal<typeof Lib>()
  return {
    ...originalLib,
    generateTemplate: () => '',
  }
})

vi.mock('../../../../lib/schemaHelpers', async (importOriginal) => {
  const originalSchemaHelpers = await importOriginal<typeof SchemaHelpers>()
  const nodePath = await import('node:path')
  // Use importActual to bypass the node:fs mock (memfs) and read from real disk
  const nodeFs = await vi.importActual<typeof NodeFs>('node:fs')
  return {
    ...originalSchemaHelpers,
    getSchema: () => {
      return JSON.parse(
        nodeFs.readFileSync(
          nodePath.join(globalThis.__dirname, 'fixtures', 'post.json'),
          'utf-8',
        ),
      )
    },
  }
})

const templateDirectoryNames = [
  'assets',
  'components',
  'layouts',
  'lib',
  'pages',
]
const templateDirectories = templateDirectoryNames.map((name) => {
  return customOrDefaultTemplatePath({
    side: 'web',
    generator: 'scaffold',
    templatePath: name,
  })
})
const scaffoldTemplates: Record<string, string> = {}
const actualFs = await vi.importActual<typeof NodeFs>('node:fs')
templateDirectories.forEach((directory) => {
  const dirFiles = actualFs.readdirSync(directory)
  dirFiles.forEach((file) => {
    const filePath = path.join(directory, file)
    scaffoldTemplates[filePath] = actualFs.readFileSync(filePath, 'utf-8')
  })
})

describe('rw destroy scaffold', () => {
  describe('destroy scaffold post', () => {
    beforeEach(async () => {
      // This fs is needed for the `files` function imported from `generate`
      vol.fromJSON({ 'redwood.toml': '', ...scaffoldTemplates }, '/')

      const postFiles = await files({
        ...getDefaultArgs(getDefaults()),
        docs: false,
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })

      // This fs is needed for all the tests here
      vol.fromJSON({
        'redwood.toml': '',
        ...scaffoldTemplates,
        ...postFiles,
        [getPaths().web.routes]: [
          '<Routes>',
          '  <Route path="/posts/new" page={NewPostPage} name="newPost" />',
          '  <Route path="/posts/{id:Int}/edit" page={EditPostPage} name="editPost" />',
          '  <Route path="/posts/{id:Int}" page={PostPage} name="post" />',
          '  <Route path="/posts" page={PostsPage} name="posts" />',
          '  <Route path="/" page={HomePage} name="home" />',
          '  <Route notfound page={NotFoundPage} />',
          '</Routes>',
        ].join('\n'),
      })
    })

    afterEach(() => {
      vol.fromJSON(scaffoldTemplates)
      vi.spyOn(fs, 'unlinkSync').mockClear()
    })

    test('destroys files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      return t.tasks[0].run().then(async () => {
        const generatedFiles = Object.keys(
          await files({
            ...getDefaultArgs(getDefaults()),
            docs: false,
            model: 'Post',
            tests: false,
            nestScaffoldByModel: true,
          }),
        )
        expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
        generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
      })
    })

    describe('for typescript files', () => {
      beforeEach(async () => {
        // clear filesystem so files call works as expected
        vol.reset()
        vol.fromJSON({ 'redwood.toml': '', ...scaffoldTemplates }, '/')
        vol.fromJSON({
          ...scaffoldTemplates,
          ...(await files({
            ...getDefaultArgs(getDefaults()),
            docs: false,
            typescript: true,
            model: 'Post',
            tests: false,
            nestScaffoldByModel: true,
          })),
          [getPaths().web.routes]: [
            '<Routes>',
            '  <Route path="/posts/new" page={PostNewPostPage} name="newPost" />',
            '  <Route path="/posts/{id:Int}/edit" page={PostEditPostPage} name="editPost" />',
            '  <Route path="/posts/{id:Int}" page={PostPostPage} name="post" />',
            '  <Route path="/posts" page={PostPostsPage} name="posts" />',
            '  <Route path="/" page={HomePage} name="home" />',
            '  <Route notfound page={NotFoundPage} />',
            '</Routes>',
          ].join('\n'),
        })
      })

      test('destroys files', async () => {
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
        const t = tasks({
          model: 'Post',
          tests: false,
          nestScaffoldByModel: true,
        })
        t.options.renderer = 'silent'

        return t.tasks[0].run().then(async () => {
          const generatedFiles = Object.keys(
            await files({
              ...getDefaultArgs(getDefaults()),
              docs: false,
              typescript: true,
              model: 'Post',
              tests: false,
              nestScaffoldByModel: true,
            }),
          )
          expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
          generatedFiles.forEach((f) =>
            expect(unlinkSpy).toHaveBeenCalledWith(f),
          )
        })
      })

      test('keeps the shared ScaffoldLayout', async () => {
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
        const t = tasks({
          model: 'Post',
          tests: false,
          nestScaffoldByModel: true,
        })
        t.options.renderer = 'silent'

        await t.tasks[0].run()

        const deletedFiles = unlinkSpy.mock.calls.map((call) => String(call[0]))
        expect(
          deletedFiles.filter((file) =>
            file.includes(path.join('layouts', 'ScaffoldLayout')),
          ),
        ).toEqual([])
      })
    })

    test('cleans up routes from Routes.js', async () => {
      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      return t.tasks[1].run().then(() => {
        const routes = fs.readFileSync(getPaths().web.routes, 'utf-8')
        expect(routes).toEqual(
          [
            '<Routes>',
            '  <Route path="/" page={HomePage} name="home" />',
            '  <Route notfound page={NotFoundPage} />',
            '</Routes>',
          ].join('\n'),
        )
      })
    })

    test('destroys the scaffold specific layout, but not the shared one', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      await t.tasks[0].run()

      expect(unlinkSpy).toHaveBeenCalledWith(
        path.join(
          getPaths().web.layouts,
          'PostsScaffoldLayout',
          'PostsScaffoldLayout.jsx',
        ),
      )
      expect(unlinkSpy).not.toHaveBeenCalledWith(
        path.join(
          getPaths().web.layouts,
          'ScaffoldLayout',
          'ScaffoldLayout.jsx',
        ),
      )
    })

    test('removes the scaffold Set, PrivateSet and layout import', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Router, Route, Set, PrivateSet } from '@cedarjs/router'",
          '',
          "import PostsScaffoldLayout from 'src/layouts/PostsScaffoldLayout'",
          '',
          'const Routes = () => {',
          '  return (',
          '    <Router>',
          '      <PrivateSet unauthenticated="login">',
          '        <Set wrap={PostsScaffoldLayout}>',
          '          <Route path="/posts/new" page={PostNewPostPage} name="newPost" />',
          '          <Route path="/posts/{id:Int}/edit" page={PostEditPostPage} name="editPost" />',
          '          <Route path="/posts/{id:Int}" page={PostPostPage} name="post" />',
          '          <Route path="/posts" page={PostPostsPage} name="posts" />',
          '        </Set>',
          '      </PrivateSet>',
          '      <Route path="/" page={HomePage} name="home" />',
          '      <Route notfound page={NotFoundPage} />',
          '    </Router>',
          '  )',
          '}',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Cleaning up routes and removing the layout import
      await t.tasks[1].run()
      await t.tasks[3].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(
        [
          "import { Router, Route, Set, PrivateSet } from '@cedarjs/router'",
          '',
          'const Routes = () => {',
          '  return (',
          '    <Router>',
          '      <Route path="/" page={HomePage} name="home" />',
          '      <Route notfound page={NotFoundPage} />',
          '    </Router>',
          '  )',
          '}',
        ].join('\n'),
      )
    })
    test('keeps PrivateSet in the router import when removing Set', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Router, Route, PrivateSet, Set } from '@cedarjs/router'",
          '',
          'const Routes = () => (',
          '  <Router>',
          '    <PrivateSet unauthenticated="home">',
          '      <Route path="/admin" page={AdminPage} name="admin" />',
          '    </PrivateSet>',
          '  </Router>',
          ')',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toContain(
        "import { Router, Route, PrivateSet } from '@cedarjs/router'",
      )
    })

    test('keeps comments in the router import when removing Set', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          'import {',
          '  Router,',
          '  Route,',
          '  Set, // route groups',
          "} from '@cedarjs/router'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toContain(
        [
          'import {',
          '  Router,',
          '  Route, // route groups',
          "} from '@cedarjs/router'",
        ].join('\n'),
      )
    })

    test('removes an import of only Set', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Set } from '@cedarjs/router'",
          "import HomePage from 'src/pages/HomePage'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(
        [
          "import HomePage from 'src/pages/HomePage'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )
    })

    test('only removes the Set import when the router is imported twice', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Set } from '@cedarjs/router'",
          "import HomePage from 'src/pages/HomePage'",
          "import { Router, Route } from '@cedarjs/router'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(
        [
          "import HomePage from 'src/pages/HomePage'",
          "import { Router, Route } from '@cedarjs/router'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )
    })

    test('keeps an aliased Set import', async () => {
      const routes = [
        "import { Router, Route, Set as RouteSet } from '@cedarjs/router'",
        '',
        'const Routes = () => (',
        '  <Router>',
        '    <RouteSet>',
        '      <Route path="/" page={HomePage} name="home" />',
        '    </RouteSet>',
        '  </Router>',
        ')',
      ].join('\n')
      fs.writeFileSync(getPaths().web.routes, routes)

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(routes)
    })

    test('skips the Set import removal when Routes cannot be parsed', async () => {
      const routes = [
        "import { Router, Route, Set } from '@cedarjs/router'",
        '',
        'const Routes = () => <Router',
      ].join('\n')
      fs.writeFileSync(getPaths().web.routes, routes)

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(routes)
    })

    test('removes an unused PrivateSet import too', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Router, Route, Set, PrivateSet } from '@cedarjs/router'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the Set import
      await t.tasks[2].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(
        [
          "import { Router, Route } from '@cedarjs/router'",
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )
    })

    test('only removes the PrivateSet around the scaffold Set', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          "import { Router, Route, Set, PrivateSet } from '@cedarjs/router'",
          '',
          "import PostsScaffoldLayout from 'src/layouts/PostsScaffoldLayout'",
          '',
          'const Routes = () => {',
          '  return (',
          '    <Router>',
          '      <PrivateSet unauthenticated="home">',
          '      </PrivateSet>',
          '      <PrivateSet unauthenticated="login">',
          '        <Set wrap={PostsScaffoldLayout}>',
          '          <Route path="/posts" page={PostPostsPage} name="posts" />',
          '        </Set>',
          '      </PrivateSet>',
          '      <Route path="/" page={HomePage} name="home" />',
          '    </Router>',
          '  )',
          '}',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Cleaning up routes
      await t.tasks[1].run()

      const routes = fs.readFileSync(getPaths().web.routes, 'utf-8')
      expect(routes).toContain('<PrivateSet unauthenticated="home">')
      expect(routes).not.toContain('<PrivateSet unauthenticated="login">')
      expect(routes).not.toContain('PostsScaffoldLayout}')
    })

    test('removes a double-quoted layout import', async () => {
      fs.writeFileSync(
        getPaths().web.routes,
        [
          'import { Router, Route } from "@cedarjs/router";',
          'import PostsScaffoldLayout from "src/layouts/PostsScaffoldLayout";',
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )

      const t = tasks({
        model: 'Post',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      // Removing the layout import
      await t.tasks[3].run()

      expect(fs.readFileSync(getPaths().web.routes, 'utf-8')).toEqual(
        [
          'import { Router, Route } from "@cedarjs/router";',
          '',
          'const Routes = () => <Router />',
        ].join('\n'),
      )
    })
  })

  describe('destroy namespaced scaffold post', () => {
    beforeEach(async () => {
      // vol.fromJSON(scaffoldTemplates)
      vol.fromJSON({
        'redwood.toml': '',
        ...scaffoldTemplates,
        ...(await files({
          ...getDefaultArgs(getDefaults()),
          docs: false,
          model: 'Post',
          path: 'admin',
          tests: false,
          nestScaffoldByModel: true,
        })),
        [getPaths().web.routes]: [
          '<Routes>',
          '  <Route path="/admin/posts/new" page={AdminPostNewPostPage} name="adminNewPost" />',
          '  <Route path="/admin/posts/{id:Int}/edit" page={AdminPostEditPostPage} name="adminEditPost" />',
          '  <Route path="/admin/posts/{id:Int}" page={AdminPostPostPage} name="adminPost" />',
          '  <Route path="/" page={HomePage} name="home" />',
          '  <Route notfound page={NotFoundPage} />',
          '</Routes>',
        ].join('\n'),
      })
    })

    afterEach(() => {
      vol.fromJSON(scaffoldTemplates)
      vi.spyOn(fs, 'unlinkSync').mockClear()
    })

    test('destroys files', async () => {
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
      const t = tasks({
        model: 'Post',
        path: 'admin',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      return t.tasks[0].run().then(async () => {
        const generatedFiles = Object.keys(
          await files({
            ...getDefaultArgs(getDefaults()),
            docs: false,
            model: 'Post',
            path: 'admin',
            tests: false,
            nestScaffoldByModel: true,
          }),
        )
        expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
        generatedFiles.forEach((f) => expect(unlinkSpy).toHaveBeenCalledWith(f))
      })
    })

    describe('for typescript files', () => {
      beforeEach(async () => {
        // clear filesystem so files call works as expected
        vol.fromJSON(scaffoldTemplates)

        vol.fromJSON({
          ...scaffoldTemplates,
          ...(await files({
            ...getDefaultArgs(getDefaults()),
            docs: false,
            model: 'Post',
            path: 'admin',
            tests: false,
            nestScaffoldByModel: true,
          })),
          [getPaths().web.routes]: [
            '<Routes>',
            '  <Route path="/admin/posts/new" page={AdminPostNewPostPage} name="adminNewPost" />',
            '  <Route path="/admin/posts/{id:Int}/edit" page={AdminPostEditPostPage} name="adminEditPost" />',
            '  <Route path="/admin/posts/{id:Int}" page={AdminPostPostPage} name="adminPost" />',
            '  <Route path="/" page={HomePage} name="home" />',
            '  <Route notfound page={NotFoundPage} />',
            '</Routes>',
          ].join('\n'),
        })
      })
      test('destroys files', async () => {
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync')
        const t = tasks({
          model: 'Post',
          path: 'admin',
          tests: false,
          nestScaffoldByModel: true,
        })
        t.options.renderer = 'silent'

        return t.tasks[0].run().then(async () => {
          const generatedFiles = Object.keys(
            await files({
              ...getDefaultArgs(getDefaults()),
              docs: false,
              model: 'Post',
              path: 'admin',
              tests: false,
              nestScaffoldByModel: true,
            }),
          )
          expect(generatedFiles.length).toEqual(unlinkSpy.mock.calls.length)
          generatedFiles.forEach((f) =>
            expect(unlinkSpy).toHaveBeenCalledWith(f),
          )
        })
      })
    })

    test('cleans up routes from Routes.js', async () => {
      const t = tasks({
        model: 'Post',
        path: 'admin',
        tests: false,
        nestScaffoldByModel: true,
      })
      t.options.renderer = 'silent'

      return t.tasks[1].run().then(() => {
        const routes = fs.readFileSync(getPaths().web.routes, 'utf-8')
        expect(routes).toEqual(
          [
            '<Routes>',
            '  <Route path="/" page={HomePage} name="home" />',
            '  <Route notfound page={NotFoundPage} />',
            '</Routes>',
          ].join('\n'),
        )
      })
    })
  })
})
