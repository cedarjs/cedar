import crypto from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

import { $, cd, path, ProcessOutput } from 'zx'

// Suppress DEP0190 warning on Windows for zx shell usage. See the same
// workaround in tasks/e2e-background-jobs/run.mts
if (process.platform === 'win32') {
  process.removeAllListeners('warning')
  process.on('warning', (warning) => {
    if (
      warning.name === 'DeprecationWarning' &&
      warning.message.includes('DEP0190')
    ) {
      return
    }
    console.warn(warning)
  })
}

$.verbose = true

const FIXTURES = path.join(import.meta.dirname, 'fixtures')

/** The fixture's own models, which stay global (next step 2) */
const GLOBAL_FIXTURE_MODELS = ['post', 'contact', 'userExample']

async function main() {
  const inputPath = process.argv.slice(2).find((arg) => !arg.startsWith('--'))

  if (!inputPath) {
    console.error('Usage: yarn e2e:tenancy <project directory>')
    process.exit(1)
  }

  const projectPath = path.resolve(inputPath)
  cd(projectPath)

  console.log(`Running the tenancy E2E test in project: ${projectPath}`)

  await step('`yarn cedar setup tenancy`', async () => {
    await $`yarn cedar setup tenancy`
    confirmSetup(projectPath)
  })

  await step('the printed next steps', async () => {
    await $`yarn cedar prisma migrate dev --name tenancy`
    await $`yarn cedar prisma generate`
    await $`yarn cedar data-migrate up`
    keepFixtureModelsGlobal(projectPath)
  })

  await step('adding organization pages and routes', async () => {
    addOrganizationPages(projectPath)
    // In the app's style, as an editor would save these edits. Only these
    // files, so setup's own lint errors still fail the lint step
    await $`yarn cedar lint --fix api/src/lib/db.ts web/src/Routes.tsx web/src/pages/OrganizationsPage web/src/pages/OrganizationPage`
    await $`yarn cedar generate types`
  })

  await step('the app builds', () => $`yarn cedar build`)
  await step('the app type-checks', () => $`yarn cedar type-check`)
  await step('the app lints', () => $`yarn cedar lint`)
  await step('the api tests pass', () => $`yarn cedar test api --no-watch`)
  await step('the web tests pass', () => $`yarn cedar test web --no-watch`)

  await step(
    'running `yarn cedar setup tenancy` again changes nothing',
    async () => {
      const before = snapshot(projectPath)
      await $`yarn cedar setup tenancy`
      const after = snapshot(projectPath)

      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (file) => before.get(file) !== after.get(file),
      )

      if (changed.length > 0) {
        throw new Error(`These files changed:\n${changed.join('\n')}`)
      }
    },
  )

  console.log('\n✅ All tests passed 🎉')
}

async function step(title: string, run: () => Promise<unknown> | unknown) {
  console.log(`\n❓ Testing: ${title}`)

  try {
    await run()
  } catch (error) {
    console.error(`💥 Failed: ${title}`)
    console.error(error instanceof ProcessOutput ? error.toString() : error)
    process.exit(1)
  }

  console.log(`Confirmed: ${title}`)
}

/** Every file under `dir`, as paths relative to `base` */
function filesIn(base: string, dir: string): string[] {
  const absolute = path.join(base, dir)

  if (!fs.existsSync(absolute)) {
    return []
  }

  return fs
    .readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(base, path.join(entry.parentPath, entry.name)),
    )
}

function confirmSetup(projectPath: string) {
  const read = (file: string) =>
    fs.readFileSync(path.join(projectPath, file), 'utf-8')
  const exists = (file: string) => fs.existsSync(path.join(projectPath, file))

  for (const file of [
    'api/src/directives/requireAuth/requireAuth.ts',
    'api/src/directives/requirePermission/requirePermission.ts',
    'api/src/lib/permissions.ts',
    'packages/permissions/src/index.ts',
    'web/src/tenancy.tsx',
  ]) {
    if (!exists(file)) {
      throw new Error(`Expected ${file} to exist`)
    }
  }

  // The app's own requireAuth stays: there were no organizations before, so
  // every existing field is about the user
  if (!read('api/src/graphql/posts.sdl.ts').includes('@requireAuth')) {
    throw new Error('Expected posts.sdl.ts to still use @requireAuth')
  }

  // The app's own hasRole and requireAuth stay too, and getCurrentUser
  // gives each membership its permissions
  const auth = read('api/src/lib/auth.ts')

  if (!/\bwithPermissions\(/.test(auth) || !/\bhasRole\b/.test(auth)) {
    throw new Error(
      'Expected api/src/lib/auth.ts to keep hasRole and use withPermissions',
    )
  }
}

/** Next step 2: the fixture's models don't belong to an organization */
function keepFixtureModelsGlobal(projectPath: string) {
  const dbPath = path.join(projectPath, 'api/src/lib/db.ts')
  const db = fs.readFileSync(dbPath, 'utf-8')
  const allExcept = /allExcept:\s*\[([^\]]*)\]/

  if (!allExcept.test(db)) {
    throw new Error('Expected an allExcept list in api/src/lib/db.ts')
  }

  fs.writeFileSync(
    dbPath,
    db.replace(allExcept, (_list, names: string) => {
      const added = GLOBAL_FIXTURE_MODELS.map((name) => `'${name}'`).join(', ')

      return `allExcept: [${names.trim().replace(/,$/, '')}, ${added}]`
    }),
  )
}

/**
 * The pages the Playwright suite in tasks/smoke-tests/tenancy uses: a list
 * of the user's organizations, an organization's page in a `PrivateSet`, and
 * the invitation route `setup tenancy` asks for
 */
function addOrganizationPages(projectPath: string) {
  for (const page of ['OrganizationsPage', 'OrganizationPage']) {
    const pageDir = path.join(projectPath, 'web/src/pages', page)

    fs.mkdirSync(pageDir, { recursive: true })
    fs.copyFileSync(
      path.join(FIXTURES, `${page}.tsx`),
      path.join(pageDir, `${page}.tsx`),
    )
  }

  // The organization's page under the app's tenancy in a web test
  fs.copyFileSync(
    path.join(FIXTURES, 'OrganizationPage.test.tsx'),
    path.join(
      projectPath,
      'web/src/pages/OrganizationPage/OrganizationPage.test.tsx',
    ),
  )

  const routesPath = path.join(projectPath, 'web/src/Routes.tsx')
  const routes = fs.readFileSync(routesPath, 'utf-8')
  const routerImport =
    "import { Router, Route, Private, Set } from '@cedarjs/router'\n"
  const firstSet = '      <Set wrap={ContactsScaffoldLayout}>\n'

  if (!routes.includes(routerImport) || !routes.includes(firstSet)) {
    throw new Error("web/src/Routes.tsx doesn't look like the fixture's")
  }

  fs.writeFileSync(
    routesPath,
    routes
      .replace(
        routerImport,
        "import { Router, Route, Private, PrivateSet, Set } from '@cedarjs/router'\n",
      )
      .replace(
        firstSet,
        '      <Route path="/invite/{token}" page={InvitePage} name="invite" />\n' +
          '      <Route path="/orgs" page={OrganizationsPage} name="organizations" />\n' +
          '      <PrivateSet unauthenticated="login">\n' +
          '        <Route path="/org/{orgSlug}" page={OrganizationPage} name="organization" />\n' +
          '      </PrivateSet>\n' +
          firstSet,
      ),
  )
}

/**
 * A hash of every file `setup tenancy` writes or edits, keyed by path, to
 * compare before and after running it again
 */
function snapshot(projectPath: string) {
  const files = [
    'cedar.toml',
    '.gitignore',
    'package.json',
    'yarn.lock',
    'api/package.json',
    'web/package.json',
    'api/tsconfig.json',
    'web/tsconfig.json',
    'scripts/tsconfig.json',
    'api/db/schema.prisma',
    'packages/permissions/package.json',
    'packages/permissions/tsconfig.json',
    ...[
      'api/src',
      'api/db/dataMigrations',
      'web/src',
      'packages/permissions/src',
    ].flatMap((dir) => filesIn(projectPath, dir)),
  ].filter((file) => fs.existsSync(path.join(projectPath, file)))

  return new Map(
    files.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(projectPath, file)))
        .digest('hex'),
    ]),
  )
}

main()
