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

async function main() {
  const inputPath = process.argv.slice(2).find((arg) => !arg.startsWith('--'))

  if (!inputPath) {
    console.error('Usage: yarn e2e:permissions <project directory>')
    process.exit(1)
  }

  const projectPath = path.resolve(inputPath)
  cd(projectPath)

  console.log(`Running the permissions E2E test in project: ${projectPath}`)

  await step('`yarn cedar setup permissions`', async () => {
    await $`yarn cedar setup permissions`
    confirmSetup(projectPath)
  })

  await step('giving a role a permission and checking it', async () => {
    usePermission(projectPath)
    await $`yarn workspace @my-org/permissions build`
    // In the app's style, as an editor would save these edits
    await $`yarn cedar lint --fix api/src/graphql/contacts.sdl.ts api/src/lib/contactPermissions.test.ts web/src/Routes.tsx web/src/components/AdminNotice packages/permissions/src/index.ts`
    await $`yarn cedar generate types`
  })

  await step('the app builds', () => $`yarn cedar build`)
  await step('the app type-checks', () => $`yarn cedar type-check`)
  await step('the app lints', () => $`yarn cedar lint`)
  await step('the api tests pass', () => $`yarn cedar test api --no-watch`)
  await step('the web tests pass', () => $`yarn cedar test web --no-watch`)

  await step(
    'running `yarn cedar setup permissions` again changes nothing',
    async () => {
      const before = snapshot(projectPath)
      await $`yarn cedar setup permissions`
      const after = snapshot(projectPath)

      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (file) => before.get(file) !== after.get(file),
      )

      if (changed.length > 0) {
        throw new Error(`These files changed:\n${changed.join('\n')}`)
      }
    },
  )

  await step(
    '`yarn cedar setup tenancy` keeps the map and the directive',
    async () => {
      const read = (file: string) =>
        fs.readFileSync(path.join(projectPath, file), 'utf-8')
      const map = read('packages/permissions/src/index.ts')
      const directive = read(
        'api/src/directives/requirePermission/requirePermission.ts',
      )

      await $`yarn cedar setup tenancy`

      if (read('packages/permissions/src/index.ts') !== map) {
        throw new Error('Expected packages/permissions to be kept')
      }

      if (
        read('api/src/directives/requirePermission/requirePermission.ts') !==
        directive
      ) {
        throw new Error('Expected the requirePermission directive to be kept')
      }

      if (!read('api/src/lib/permissions.ts').includes('@cedarjs/tenancy')) {
        throw new Error(
          'Expected api/src/lib/permissions.ts to check memberships',
        )
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

function confirmSetup(projectPath: string) {
  const read = (file: string) =>
    fs.readFileSync(path.join(projectPath, file), 'utf-8')

  for (const file of [
    'api/src/directives/requirePermission/requirePermission.ts',
    'api/src/directives/requirePermission/requirePermission.test.ts',
    'api/src/lib/permissions.ts',
    'packages/permissions/src/index.ts',
  ]) {
    if (!fs.existsSync(path.join(projectPath, file))) {
      throw new Error(`Expected ${file} to exist`)
    }
  }

  // The fixture's `@requireAuth(roles: ["ADMIN"])` names the one role
  if (!/\bADMIN: \[\]/.test(read('packages/permissions/src/index.ts'))) {
    throw new Error('Expected an ADMIN entry with no permissions in the map')
  }

  if (
    !read('api/src/graphql/contacts.sdl.ts').includes(
      '@requireAuth(roles: ["ADMIN"])',
    )
  ) {
    throw new Error('Expected contacts.sdl.ts to keep its roles list')
  }

  if (!/\bwithPermissions\(/.test(read('api/src/lib/auth.ts'))) {
    throw new Error('Expected getCurrentUser to use withPermissions')
  }
}

/**
 * Gives ADMIN `contacts.delete`, and checks it in the SDL, a service test,
 * a route and a component with its test
 */
function usePermission(projectPath: string) {
  const edit = (file: string, from: string | RegExp, to: string) => {
    const filePath = path.join(projectPath, file)
    const source = fs.readFileSync(filePath, 'utf-8')

    const found =
      typeof from === 'string' ? source.includes(from) : from.test(source)

    if (!found) {
      throw new Error(`${file} doesn't look like the fixture's`)
    }

    fs.writeFileSync(filePath, source.replace(from, to))
  }

  edit(
    'packages/permissions/src/index.ts',
    /permissions: \[\],\s*roles: \{\s*ADMIN: \[\],/,
    "permissions: ['contacts.delete'],\n  roles: {\n    ADMIN: ['contacts.delete'],",
  )
  edit(
    'api/src/graphql/contacts.sdl.ts',
    '@requireAuth(roles: ["ADMIN"])',
    '@requirePermission(permission: "contacts.delete")',
  )
  edit(
    'web/src/Routes.tsx',
    '        <Route path="/about" page={AboutPage} name="about" prerender />\n',
    '        <Route path="/about" page={AboutPage} name="about" prerender />\n' +
      '        <Private unauthenticated="login" unauthorized="home" permission="contacts.delete">\n' +
      '          <Route path="/admin" page={AboutPage} name="admin" />\n' +
      '        </Private>\n',
  )

  fs.copyFileSync(
    path.join(FIXTURES, 'contactPermissions.test.ts'),
    path.join(projectPath, 'api/src/lib/contactPermissions.test.ts'),
  )

  const componentDir = path.join(projectPath, 'web/src/components/AdminNotice')
  fs.mkdirSync(componentDir, { recursive: true })

  for (const file of ['AdminNotice.tsx', 'AdminNotice.test.tsx']) {
    fs.copyFileSync(path.join(FIXTURES, file), path.join(componentDir, file))
  }
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

/**
 * A hash of every file `setup permissions` writes or edits, keyed by path,
 * to compare before and after running it again
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
    'packages/permissions/package.json',
    'packages/permissions/tsconfig.json',
    ...['api/src', 'web/src', 'packages/permissions/src'].flatMap((dir) =>
      filesIn(projectPath, dir),
    ),
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
