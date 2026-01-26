import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import {
  getExecaOptions,
  applyCodemod,
  updatePkgJsonScripts,
  getCfwBin,
  // TODO: See if we can get rid of this and just use execa directly
  exec,
} from './util.mts'

// This variable gets used in other functions
// and is set when webTasks, apiTasks, streamingTasks or fragmentsTasks are
// called
let OUTPUT_PATH: string | undefined

export function setOutputPath(path: string) {
  OUTPUT_PATH = path
}

export function getOutputPath() {
  if (!OUTPUT_PATH) {
    throw new Error('Output path not set')
  }

  return OUTPUT_PATH
}

export function fullPath(
  name: string,
  { addExtension } = { addExtension: true },
) {
  if (!OUTPUT_PATH) {
    throw new Error('Output path not set')
  }

  if (addExtension) {
    if (name.startsWith('api')) {
      name += '.ts'
    } else if (name.startsWith('web')) {
      name += '.tsx'
    }
  }

  return path.join(OUTPUT_PATH, name)
}

/**
 * @param cmd The command to run
 */
export function createBuilder(cmd: string, dir = '') {
  if (!OUTPUT_PATH) {
    throw new Error('Output path not set')
  }

  const execaOptions = getExecaOptions(path.join(OUTPUT_PATH, dir))

  return async function createItem(positionals?: string | string[]) {
    const args = positionals
      ? Array.isArray(positionals)
        ? positionals
        : [positionals]
      : []
    return execa(cmd, args, execaOptions)
  }
}

function getPagesTasks() {
  // Passing 'web' here to test executing 'yarn cedar' in the /web directory
  // to make sure it works as expected. We do the same for the /api directory
  // further down in this file.
  const createPage = createBuilder('yarn cedar g page', 'web')

  return [
    {
      title: 'Creating home page',
      task: async () => {
        await createPage('home /')

        await applyCodemod(
          'homePage.js',
          fullPath('web/src/pages/HomePage/HomePage'),
        )
      },
    },
    {
      title: 'Creating about page',
      task: async () => {
        await createPage('about')

        await applyCodemod(
          'aboutPage.js',
          fullPath('web/src/pages/AboutPage/AboutPage'),
        )
      },
    },
    {
      title: 'Creating contact page',
      task: async () => {
        await createPage('contactUs /contact')

        await applyCodemod(
          'contactUsPage.js',
          fullPath('web/src/pages/ContactUsPage/ContactUsPage'),
        )
      },
    },
    {
      title: 'Creating blog post page',
      task: async () => {
        await createPage('blogPost /blog-post/{id:Int}')

        await applyCodemod(
          'blogPostPage.js',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage'),
        )

        return applyCodemod(
          'updateBlogPostPageStories.js',
          fullPath('web/src/pages/BlogPostPage/BlogPostPage.stories'),
        )
      },
    },
    {
      title: 'Creating profile page',
      task: async () => {
        await createPage('profile /profile')

        // Update the profile page test
        const testFileContent = `import { render, waitFor, screen } from '@cedarjs/testing/web'

      import ProfilePage from './ProfilePage'

      describe('ProfilePage', () => {
        it('renders successfully', async () => {
          mockCurrentUser({
            email: 'danny@bazinga.com',
            id: '84849020-2b1a-4f5c-8c7d-000084849020',
            roles: 'BAZINGA',
          })

          await waitFor(async () => {
            expect(() => {
              render(<ProfilePage />)
            }).not.toThrow()
          })

          expect(await screen.findByText('danny@bazinga.com')).toBeInTheDocument()
        })
      })
      `

        fs.writeFileSync(
          fullPath('web/src/pages/ProfilePage/ProfilePage.test'),
          testFileContent,
        )

        return applyCodemod(
          'profilePage.js',
          fullPath('web/src/pages/ProfilePage/ProfilePage'),
        )
      },
    },
    {
      title: 'Creating MDX Storybook stories',
      task: () => {
        const cedarMdxStoryContent = fs.readFileSync(
          `${path.resolve(import.meta.dirname, 'codemods', 'CedarJS.mdx')}`,
        )

        fs.writeFileSync(
          fullPath('web/src/CedarJS.mdx', { addExtension: false }),
          cedarMdxStoryContent,
        )

        return
      },
    },
    {
      title: 'Creating nested cells test page',
      task: async () => {
        await createPage('waterfall {id:Int}')

        await applyCodemod(
          'waterfallPage.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage'),
        )

        await applyCodemod(
          'updateWaterfallPageStories.js',
          fullPath('web/src/pages/WaterfallPage/WaterfallPage.stories'),
        )
      },
    },
  ]
}

export function webTasksList() {
  const taskList = [
    {
      title: 'Creating pages',
      task: async () => getPagesTasks(),
      isNested: true,
    },
    {
      title: 'Creating layout',
      task: () => createLayout(),
    },
    {
      title: 'Creating components',
      task: () => createComponents(),
    },
    {
      title: 'Creating cells',
      task: () => createCells(),
    },
    {
      title: 'Updating cell mocks',
      task: () => updateCellMocks(),
    },
    {
      title: 'Changing routes',
      task: () => applyCodemod('routes.js', fullPath('web/src/Routes')),
    },
  ]

  return taskList
}

export async function createLayout() {
  const createLayout = createBuilder('yarn cedar g layout')

  await createLayout('blog')

  return applyCodemod(
    'blogLayout.js',
    fullPath('web/src/layouts/BlogLayout/BlogLayout'),
  )
}

export async function createComponents() {
  const createComponent = createBuilder('yarn cedar g component')

  await createComponent('blogPost')

  await applyCodemod(
    'blogPost.js',
    fullPath('web/src/components/BlogPost/BlogPost'),
  )

  await createComponent('author')

  await applyCodemod('author.js', fullPath('web/src/components/Author/Author'))

  await applyCodemod(
    'updateAuthorStories.js',
    fullPath('web/src/components/Author/Author.stories'),
  )

  await applyCodemod(
    'updateAuthorTest.js',
    fullPath('web/src/components/Author/Author.test'),
  )

  await createComponent('classWithClassField')

  await applyCodemod(
    'classWithClassField.ts',
    fullPath('web/src/components/ClassWithClassField/ClassWithClassField'),
  )
}

export async function createCells() {
  const createCell = createBuilder('yarn cedar g cell')

  await createCell('blogPosts')

  await applyCodemod(
    'blogPostsCell.js',
    fullPath('web/src/components/BlogPostsCell/BlogPostsCell'),
  )

  await createCell('blogPost')

  await applyCodemod(
    'blogPostCell.js',
    fullPath('web/src/components/BlogPostCell/BlogPostCell'),
  )

  await createCell('author')

  await applyCodemod(
    'authorCell.js',
    fullPath('web/src/components/AuthorCell/AuthorCell'),
  )

  await applyCodemod(
    'updateAuthorCellTest.js',
    fullPath('web/src/components/AuthorCell/AuthorCell.test'),
  )

  await createCell('waterfallBlogPost')

  return applyCodemod(
    'waterfallBlogPostCell.js',
    fullPath('web/src/components/WaterfallBlogPostCell/WaterfallBlogPostCell'),
  )
}

export async function updateCellMocks() {
  await applyCodemod(
    'updateBlogPostMocks.js',
    fullPath('web/src/components/BlogPostCell/BlogPostCell.mock.ts', {
      addExtension: false,
    }),
  )

  await applyCodemod(
    'updateBlogPostMocks.js',
    fullPath('web/src/components/BlogPostsCell/BlogPostsCell.mock.ts', {
      addExtension: false,
    }),
  )

  await applyCodemod(
    'updateAuthorCellMock.js',
    fullPath('web/src/components/AuthorCell/AuthorCell.mock.ts', {
      addExtension: false,
    }),
  )

  return applyCodemod(
    'updateWaterfallBlogPostMocks.js',
    fullPath(
      'web/src/components/WaterfallBlogPostCell/WaterfallBlogPostCell.mock.ts',
      {
        addExtension: false,
      },
    ),
  )
}

export async function addModel(schema: string) {
  const prismaPath = `${getOutputPath()}/api/db/schema.prisma`

  const current = fs.readFileSync(prismaPath, 'utf-8')

  fs.writeFileSync(prismaPath, `${current.trim()}\n\n${schema}\n`)
}

export async function addDbAuth(
  outputPath: string,
  linkWithLatestFwBuild: boolean,
) {
  // Temporarily disable postinstall script
  updatePkgJsonScripts({
    projectPath: outputPath,
    scripts: {
      postinstall: '',
    },
  })

  // We want to use the latest version of the auth-dbauth-{setup,api,web}
  // packages. But they're not published yet. So let's package them up as
  // tarballs and install them using that by setting yarn resolutions

  const cedarFrameworkPath = path.join(import.meta.dirname, '../../')
  const dbAuthPackagePath = path.join(
    cedarFrameworkPath,
    'packages',
    'auth-providers',
    'dbAuth',
  )
  const setupPkg = path.join(dbAuthPackagePath, 'setup')
  const apiPkg = path.join(dbAuthPackagePath, 'api')
  const webPkg = path.join(dbAuthPackagePath, 'web')

  await exec('yarn build:pack', [], getExecaOptions(setupPkg))
  await exec('yarn build:pack', [], getExecaOptions(apiPkg))
  await exec('yarn build:pack', [], getExecaOptions(webPkg))

  const setupTgz = path.join(setupPkg, 'cedarjs-auth-dbauth-setup.tgz')
  const apiTgz = path.join(apiPkg, 'cedarjs-auth-dbauth-api.tgz')
  const webTgz = path.join(webPkg, 'cedarjs-auth-dbauth-web.tgz')

  const setupTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-setup.tgz')
  const apiTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-api.tgz')
  const webTgzDest = path.join(outputPath, 'cedarjs-auth-dbauth-web.tgz')

  fs.copyFileSync(setupTgz, setupTgzDest)
  fs.copyFileSync(apiTgz, apiTgzDest)
  fs.copyFileSync(webTgz, webTgzDest)

  const projectPackageJsonPath = path.join(outputPath, 'package.json')
  const projectPackageJson = JSON.parse(
    fs.readFileSync(projectPackageJsonPath, 'utf-8'),
  )

  const existingResolutions = projectPackageJson.resolutions
    ? { ...projectPackageJson.resolutions }
    : undefined

  projectPackageJson.resolutions ??= {}
  projectPackageJson.resolutions = {
    ...projectPackageJson.resolutions,
    '@cedarjs/auth-dbauth-setup': './cedarjs-auth-dbauth-setup.tgz',
    '@cedarjs/auth-dbauth-api': './cedarjs-auth-dbauth-api.tgz',
    '@cedarjs/auth-dbauth-web': './cedarjs-auth-dbauth-web.tgz',
  }

  fs.writeFileSync(
    projectPackageJsonPath,
    JSON.stringify(projectPackageJson, null, 2),
  )

  const execaOptions = getExecaOptions(outputPath)

  // Run `yarn install` to have the resolutions take effect and install the
  // tarballs we copied over
  await exec('yarn install', [], execaOptions)

  await exec(
    'yarn cedar setup auth dbAuth --force --no-webauthn --no-createUserModel --no-generateAuthPages',
    [],
    execaOptions,
  )

  // Restore old resolutions
  if (existingResolutions) {
    projectPackageJson.resolutions = existingResolutions
  }

  fs.writeFileSync(
    projectPackageJsonPath,
    JSON.stringify(projectPackageJson, null, 2),
  )

  // Remove tarballs
  fs.unlinkSync(setupTgzDest)
  fs.unlinkSync(apiTgzDest)
  fs.unlinkSync(webTgzDest)

  // Restore postinstall script
  updatePkgJsonScripts({
    projectPath: outputPath,
    scripts: {
      postinstall: `yarn ${getCfwBin(outputPath)} project:copy`,
    },
  })

  if (linkWithLatestFwBuild) {
    await exec(`yarn ${getCfwBin(outputPath)} project:copy`, [], execaOptions)
  }

  await exec(
    'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
    [],
    execaOptions,
  )

  // update directive in contacts.sdl.ts
  const pathContactsSdl = `${getOutputPath()}/api/src/graphql/contacts.sdl.ts`
  const contentContactsSdl = fs.readFileSync(pathContactsSdl, 'utf-8')
  const resultsContactsSdl = contentContactsSdl
    .replace(
      'createContact(input: CreateContactInput!): Contact! @requireAuth',
      `createContact(input: CreateContactInput!): Contact @skipAuth`,
    )
    .replace(
      /deleteContact\(id: Int!\): Contact! @requireAuth(?=\s)/,
      'deleteContact(id: Int!): Contact! @requireAuth(roles:["ADMIN"])',
    ) // make deleting contacts admin only
  fs.writeFileSync(pathContactsSdl, resultsContactsSdl)

  // update directive in posts.sdl.ts
  const pathPostsSdl = `${getOutputPath()}/api/src/graphql/posts.sdl.ts`
  const contentPostsSdl = fs.readFileSync(pathPostsSdl, 'utf-8')
  const resultsPostsSdl = contentPostsSdl.replace(
    /posts: \[Post!\]! @requireAuth([^}]*)@requireAuth/,
    `posts: [Post!]! @skipAuth
    post(id: Int!): Post @skipAuth`,
  ) // make posts accessible to all

  fs.writeFileSync(pathPostsSdl, resultsPostsSdl)

  // Update src/lib/auth to return roles, so tsc doesn't complain
  const libAuthPath = `${getOutputPath()}/api/src/lib/auth.ts`
  const libAuthContent = fs.readFileSync(libAuthPath, 'utf-8')

  const newLibAuthContent = libAuthContent
    .replace(
      'select: { id: true }',
      'select: { id: true, roles: true, email: true}',
    )
    .replace(
      'const currentUserRoles = context.currentUser?.roles',
      'const currentUserRoles = context.currentUser?.roles as string | string[]',
    )
  fs.writeFileSync(libAuthPath, newLibAuthContent)

  // update requireAuth test
  const pathRequireAuth = `${getOutputPath()}/api/src/directives/requireAuth/requireAuth.test.ts`
  const contentRequireAuth = fs.readFileSync(pathRequireAuth).toString()
  const resultsRequireAuth = contentRequireAuth.replace(
    /const mockExecution([^}]*){} }\)/,
    `const mockExecution = mockRedwoodDirective(requireAuth, {
      context: { currentUser: { id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d', roles: 'ADMIN', email: 'b@zinga.com' } },
    })`,
  )
  fs.writeFileSync(pathRequireAuth, resultsRequireAuth)

  // add fullName input to signup form
  const pathSignupPageTs = `${getOutputPath()}/web/src/pages/SignupPage/SignupPage.tsx`
  const contentSignupPageTs = fs.readFileSync(pathSignupPageTs, 'utf-8')
  const usernameFields = contentSignupPageTs.match(
    /\s*<Label[\s\S]*?name="username"[\s\S]*?"rw-field-error" \/>/,
  )?.[0]
  const fullNameFields = usernameFields
    ?.replace(/\s*ref=\{usernameRef}/, '')
    ?.replaceAll('username', 'full-name')
    ?.replaceAll('Username', 'Full Name')

  const newContentSignupPageTs = contentSignupPageTs
    .replace(
      '<FieldError name="password" className="rw-field-error" />',
      '<FieldError name="password" className="rw-field-error" />\n' +
        fullNameFields,
    )
    // include full-name in the data we pass to `signUp()`
    .replace(
      'password: data.password',
      "password: data.password, 'full-name': data['full-name']",
    )

  fs.writeFileSync(pathSignupPageTs, newContentSignupPageTs)

  // set fullName when signing up
  const pathAuthTs = `${getOutputPath()}/api/src/functions/auth.ts`
  const contentAuthTs = fs.readFileSync(pathAuthTs).toString()
  const resultsAuthTs = contentAuthTs
    .replace('name: string', "'full-name': string")
    .replace('userAttributes: _userAttributes', 'userAttributes')
    .replace(
      '// name: userAttributes.name',
      "fullName: userAttributes['full-name']",
    )

  fs.writeFileSync(pathAuthTs, resultsAuthTs)
}
