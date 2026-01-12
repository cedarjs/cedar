import fs from 'node:fs'
import path from 'node:path'

import type { Options as ExecaOptions } from 'execa'

import {
  createBuilder,
  createCells,
  createComponents,
  createLayout,
  fullPath,
  getOutputPath,
  getPagesTasks,
  setOutputPath,
  updateCellMocks,
  addModel,
  addDbAuth,
} from './base-tasks.mts'
import type { TuiTaskList } from './typing.mts'
import {
  getExecaOptions as utilGetExecaOptions,
  applyCodemod,
  exec,
  getCfwBin,
} from './util.mts'

function getExecaOptions(cwd: string): ExecaOptions {
  return { ...utilGetExecaOptions(cwd), stdio: 'pipe' as const }
}

export async function webTasks(outputPath: string) {
  setOutputPath(outputPath)

  const execaOptions = getExecaOptions(outputPath)

  const tuiTaskList: TuiTaskList = [
    {
      title: 'Creating pages',
      task: async () => getPagesTasks(),
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
    {
      title: 'Adding Tailwind',
      task: async () => {
        await exec('yarn cedar setup ui tailwindcss', ['--force'], execaOptions)
      },
    },
  ] //,
  // TODO: Figure out what to do with this. It's from Listr, but TUI doesn't
  //       have anything like it (yet?)
  // {
  //   exitOnError: true,
  //   renderer: verbose && 'verbose',
  // }

  return tuiTaskList
}

interface ApiTasksOptions {
  linkWithLatestFwBuild: boolean
  esmProject: boolean
}

export async function apiTasks(
  outputPath: string,
  { linkWithLatestFwBuild, esmProject }: ApiTasksOptions,
) {
  setOutputPath(outputPath)

  const execaOptions = getExecaOptions(outputPath)

  // add prerender to some routes
  const addPrerender = async () => {
    const tuiTaskList: TuiTaskList = [
      {
        // We need to do this here, and not where we create the other pages, to
        // keep it outside of BlogLayout
        title: 'Creating double rendering test page',
        task: async () => {
          const createPage = createBuilder('yarn cedar g page')
          await createPage('double')

          const doublePageContent = `import { Metadata } from '@cedarjs/web'

            import test from './test.png'

            const DoublePage = () => {
              return (
                <>
                  <Metadata title="Double" description="Double page" og />

                  <h1 className="mb-1 mt-2 text-xl font-semibold">DoublePage</h1>
                  <p>
                    This page exists to make sure we don&apos;t regress on{' '}
                    <a
                      href="https://github.com/redwoodjs/redwood/issues/7757"
                      className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
                      target="_blank"
                      rel="noreferrer"
                    >
                      #7757
                    </a>
                  </p>
                  <p>For RW#7757 it needs to be a page that is not wrapped in a Set</p>
                  <p>
                    We also use this page to make sure we don&apos;t regress on{' '}
                    <a
                      href="https://github.com/cedarjs/cedar/issues/317"
                      className="text-blue-600 underline visited:text-purple-600 hover:text-blue-800"
                      target="_blank"
                      rel="noreferrer"
                    >
                      #317
                    </a>
                  </p>
                  <img src={test} alt="Test" />
                </>
              )
            }

            export default DoublePage`

          fs.writeFileSync(
            fullPath('web/src/pages/DoublePage/DoublePage'),
            doublePageContent,
          )
          fs.copyFileSync(
            fullPath('web/public/favicon.png', { addExtension: false }),
            fullPath('web/src/pages/DoublePage/test.png', {
              addExtension: false,
            }),
          )
        },
      },
      {
        title: 'Update Routes.tsx',
        task: () => {
          const pathRoutes = `${getOutputPath()}/web/src/Routes.tsx`
          const contentRoutes = fs.readFileSync(pathRoutes).toString()
          const resultsRoutesAbout = contentRoutes.replace(
            /name="about"/,
            `name="about" prerender`,
          )
          const resultsRoutesHome = resultsRoutesAbout.replace(
            /name="home"/,
            `name="home" prerender`,
          )
          const resultsRoutesBlogPost = resultsRoutesHome.replace(
            /name="blogPost"/,
            `name="blogPost" prerender`,
          )
          const resultsRoutesNotFound = resultsRoutesBlogPost.replace(
            /page={NotFoundPage}/,
            `page={NotFoundPage} prerender`,
          )
          const resultsRoutesWaterfall = resultsRoutesNotFound.replace(
            /page={WaterfallPage}/,
            `page={WaterfallPage} prerender`,
          )
          const resultsRoutesDouble = resultsRoutesWaterfall.replace(
            'name="double"',
            'name="double" prerender',
          )
          const resultsRoutesNewContact = resultsRoutesDouble.replace(
            'name="newContact"',
            'name="newContact" prerender',
          )
          fs.writeFileSync(pathRoutes, resultsRoutesNewContact)

          const blogPostRouteHooks = `import { db } from '$api/src/lib/db.js'

            export async function routeParameters() {
              return (await db.post.findMany({ take: 7 })).map((post) => ({ id: post.id }))
            }`
          const blogPostRouteHooksPath = `${getOutputPath()}/web/src/pages/BlogPostPage/BlogPostPage.routeHooks.ts`
          fs.writeFileSync(blogPostRouteHooksPath, blogPostRouteHooks)

          const waterfallRouteHooks = `export async function routeParameters() {
              return [{ id: 2 }]
            }`
          const waterfallRouteHooksPath = `${getOutputPath()}/web/src/pages/WaterfallPage/WaterfallPage.routeHooks.ts`
          fs.writeFileSync(waterfallRouteHooksPath, waterfallRouteHooks)
        },
      },
    ]

    return tuiTaskList
  }

  const generateScaffold = createBuilder('yarn cedar g scaffold')

  const tuiTaskList: TuiTaskList = [
    {
      title: 'Adding post and user model to prisma',
      task: async () => {
        // Need both here since they have a relation
        const { post, user } = await import('./codemods/models.mts')

        addModel(post)
        addModel(user)

        return exec(
          `yarn cedar prisma migrate dev --name create_post_user`,
          [],
          execaOptions,
        )
      },
    },
    {
      title: 'Scaffolding post',
      task: async () => {
        await generateScaffold('post')

        // Replace the random numbers in the scenario with consistent values
        await applyCodemod(
          'scenarioValueSuffix.js',
          fullPath('api/src/services/posts/posts.scenarios'),
        )

        await exec(
          `yarn ${getCfwBin(getOutputPath())} project:copy`,
          [],
          execaOptions,
        )
      },
    },
    {
      title: 'Adding seed script',
      task: async () => {
        await applyCodemod(
          'seed.js',
          fullPath('scripts/seed.ts', { addExtension: false }),
        )
      },
    },
    {
      title: 'Adding contact model to prisma',
      task: async () => {
        const { contact } = await import('./codemods/models.mts')

        addModel(contact)

        await exec(
          `yarn cedar prisma migrate dev --name create_contact`,
          [],
          execaOptions,
        )

        await generateScaffold('contacts')

        const contactsServicePath = fullPath(
          'api/src/services/contacts/contacts',
        )
        fs.writeFileSync(
          contactsServicePath,
          fs
            .readFileSync(contactsServicePath, 'utf-8')
            .replace(
              "import { db } from 'src/lib/db'",
              '// Testing aliased imports with extensions\n' +
                "import { db } from 'src/lib/db.js'",
            ),
        )
      },
    },
    {
      // This task renames the migration folders so that we don't have to deal with duplicates/conflicts when committing to the repo
      title: 'Adjust dates within migration folder names',
      task: () => {
        const migrationsFolderPath = path.join(
          getOutputPath(),
          'api',
          'db',
          'migrations',
        )
        // Migration folders are folders which start with 14 digits because they have a yyyymmddhhmmss
        const migrationFolders = fs
          .readdirSync(migrationsFolderPath)
          .filter((name) => {
            return (
              name.match(/\d{14}.+/) &&
              fs.lstatSync(path.join(migrationsFolderPath, name)).isDirectory()
            )
          })
          .sort()
        const datetime = new Date('2022-01-01T12:00:00.000Z')
        migrationFolders.forEach((name) => {
          const datetimeInCorrectFormat =
            datetime.getFullYear() +
            ('0' + (datetime.getMonth() + 1)).slice(-2) +
            ('0' + datetime.getDate()).slice(-2) +
            '120000' // Time hardcoded to 12:00:00 to limit TZ issues
          fs.renameSync(
            path.join(migrationsFolderPath, name),
            path.join(
              migrationsFolderPath,
              `${datetimeInCorrectFormat}${name.substring(14)}`,
            ),
          )
          datetime.setDate(datetime.getDate() + 1)
        })
      },
    },
    {
      title: 'Add users service',
      task: async () => {
        const generateSdl = createBuilder('yarn cedar g sdl --no-crud', 'api')

        await generateSdl('user')

        await applyCodemod('usersSdl.js', fullPath('api/src/graphql/users.sdl'))

        await applyCodemod(
          'usersService.js',
          fullPath('api/src/services/users/users'),
        )

        // Replace the random numbers in the scenario with consistent values
        await applyCodemod(
          'scenarioValueSuffix.js',
          fullPath('api/src/services/users/users.scenarios'),
        )

        const test = `import { user } from './users.js'
            import type { StandardScenario } from './users.scenarios.js'

            describe('users', () => {
              scenario('returns a single user', async (scenario: StandardScenario) => {
                const result = await user({ id: scenario.user.one.id })

                expect(result).toEqual(scenario.user.one)
              })
            })`.replaceAll(/ {12}/g, '')

        fs.writeFileSync(fullPath('api/src/services/users/users.test'), test)

        return createBuilder('yarn cedar g types')()
      },
    },
    {
      title: 'Add dbAuth',
      task: async () => addDbAuth(outputPath, linkWithLatestFwBuild),
    },
    {
      title: 'Add describeScenario tests',
      task: () => {
        // Copy contact.scenarios.ts, because scenario tests look for the same filename
        fs.copyFileSync(
          fullPath('api/src/services/contacts/contacts.scenarios'),
          fullPath('api/src/services/contacts/describeContacts.scenarios'),
        )

        // Create describeContacts.test.ts
        const describeScenarioFixture = path.join(
          import.meta.dirname,
          'templates',
          'api',
          'contacts.describeScenario.test.ts.template',
        )

        fs.copyFileSync(
          describeScenarioFixture,
          fullPath('api/src/services/contacts/describeContacts.test'),
        )
      },
    },
    {
      // This is probably more of a web side task really, but the scaffolded
      // pages aren't generated until we get here to the api side tasks. So
      // instead of doing some up in the web side tasks, and then the rest
      // here I decided to move all of them here
      title: 'Add Prerender to Routes',
      task: () => addPrerender(),
    },
    {
      title: 'Add context tests',
      task: () => {
        const templatePath = path.join(
          import.meta.dirname,
          'templates',
          'api',
          'context.test.ts.template',
        )
        const projectPath = path.join(
          getOutputPath(),
          'api',
          'src',
          '__tests__',
          'context.test.ts',
        )

        fs.mkdirSync(path.dirname(projectPath), { recursive: true })
        fs.writeFileSync(projectPath, fs.readFileSync(templatePath))
      },
    },
    {
      title: 'Add vitest db import tracking tests for ESM test project',
      task: () => {
        if (!esmProject) {
          return
        }

        const templatesDir = path.join(import.meta.dirname, 'templates', 'api')
        const templatePath1 = path.join(templatesDir, '1-db-import.test.ts')
        const templatePath2 = path.join(templatesDir, '2-db-import.test.ts')
        const templatePath3 = path.join(templatesDir, '3-db-import.test.ts')

        const testsDir = path.join(getOutputPath(), 'api', 'src', '__tests__')
        const testFilePath1 = path.join(testsDir, '1-db-import.test.ts')
        const testFilePath2 = path.join(testsDir, '2-db-import.test.ts')
        const testFilePath3 = path.join(testsDir, '3-db-import.test.ts')

        fs.mkdirSync(testsDir, { recursive: true })
        fs.copyFileSync(templatePath1, testFilePath1)
        fs.copyFileSync(templatePath2, testFilePath2)
        fs.copyFileSync(templatePath3, testFilePath3)

        // I opted to add an additional vitest config file rather than modifying
        // the existing one because I wanted to keep one looking exactly the
        // same as it'll look in user's projects.
        fs.copyFileSync(
          path.join(templatesDir, 'vitest-sort.config.ts'),
          path.join(getOutputPath(), 'api', 'vitest-sort.config.ts'),
        )
      },
    },
  ]
  // ],
  // TODO: Figure out what to do with this. It's from Listr, but TUI doesn't
  //       have anything like it (yet?)
  // {
  //   exitOnError: true,
  //   renderer: verbose && 'verbose',
  //   renderOptions: { collapseSubtasks: false },
  // }
  return tuiTaskList
}

/**
 * Tasks to add GraphQL Fragments support to the test-project, and some queries
 * to test fragments
 */
export async function fragmentsTasks(outputPath: string) {
  setOutputPath(outputPath)

  const tuiTaskList: TuiTaskList = [
    {
      title: 'Enable fragments',
      task: async () => {
        const redwoodTomlPath = path.join(outputPath, 'redwood.toml')
        const redwoodToml = fs.readFileSync(redwoodTomlPath).toString()
        const newRedwoodToml = redwoodToml + '\n[graphql]\n  fragments = true\n'
        fs.writeFileSync(redwoodTomlPath, newRedwoodToml)
      },
    },
    {
      title: 'Adding produce and stall models to prisma',
      task: async () => {
        // Need both here since they have a relation
        const { produce, stall } = await import('./codemods/models.mts')

        addModel(produce)
        addModel(stall)

        return exec(
          'yarn cedar prisma migrate dev --name create_produce_stall',
          [],
          getExecaOptions(outputPath),
        )
      },
    },
    {
      title: 'Seed fragments data',
      task: async () => {
        await applyCodemod(
          'seedFragments.ts',
          fullPath('scripts/seed.ts', { addExtension: false }),
        )

        await exec('yarn cedar prisma db seed', [], getExecaOptions(outputPath))
      },
    },
    {
      title: 'Generate SDLs for produce and stall',
      task: async () => {
        const generateSdl = createBuilder('yarn cedar g sdl')

        await generateSdl('stall')
        await generateSdl('produce')

        await applyCodemod(
          'producesSdl.ts',
          fullPath('api/src/graphql/produces.sdl'),
        )
      },
    },
    {
      title: 'Copy components from templates',
      task: () => {
        const templatesPath = path.join(import.meta.dirname, 'templates', 'web')
        const componentsPath = path.join(
          getOutputPath(),
          'web',
          'src',
          'components',
        )

        for (const fileName of [
          'Card.tsx',
          'FruitInfo.tsx',
          'ProduceInfo.tsx',
          'StallInfo.tsx',
          'VegetableInfo.tsx',
        ]) {
          const templatePath = path.join(templatesPath, fileName)
          const componentPath = path.join(componentsPath, fileName)

          fs.writeFileSync(componentPath, fs.readFileSync(templatePath))
        }
      },
    },
    {
      title: 'Copy sdl and service for groceries from templates',
      task: () => {
        const templatesPath = path.join(import.meta.dirname, 'templates', 'api')
        const graphqlPath = path.join(getOutputPath(), 'api', 'src', 'graphql')
        const servicesPath = path.join(
          getOutputPath(),
          'api',
          'src',
          'services',
        )

        const sdlTemplatePath = path.join(templatesPath, 'groceries.sdl.ts')
        const sdlPath = path.join(graphqlPath, 'groceries.sdl.ts')
        const serviceTemplatePath = path.join(templatesPath, 'groceries.ts')
        const servicePath = path.join(servicesPath, 'groceries.ts')

        fs.writeFileSync(sdlPath, fs.readFileSync(sdlTemplatePath))
        fs.writeFileSync(servicePath, fs.readFileSync(serviceTemplatePath))
      },
    },
    {
      title: 'Creating Groceries page',
      task: async () => {
        const createPage = createBuilder('yarn cedar g page')
        await createPage('groceries')

        await applyCodemod(
          'groceriesPage.ts',
          fullPath('web/src/pages/GroceriesPage/GroceriesPage'),
        )
      },
    },
  ]

  return tuiTaskList
}
