import fs from 'node:fs'
import path from 'node:path'

const SOURCE_FILE = /\.(?:[jt]sx?)$/
// Test data, mocks and stories can name roles the app doesn't have
const NOT_APP_CODE = /\.(?:test|spec|scenarios|mock|mocks|stories)\.[jt]sx?$/

/** A role list's literal: `["a", "b"]`, `'a'` or `"a"` */
const LIST = String.raw`(\[[^\]]*\]|'[^'\n]*'|"[^"\n]*")`

const ROLE_LISTS = [
  // `@requireAuth(roles: ["admin"])` in an SDL, `requireAuth({ roles: 'admin' })`
  new RegExp(String.raw`\broles\s*:\s*` + LIST, 'g'),
  // `<PrivateSet roles="admin">`, `<PrivateSet roles={['admin', 'editor']}>`
  new RegExp(String.raw`\broles\s*=\s*\{?\s*` + LIST, 'g'),
  // `hasRole('admin')`, `hasRole(['admin', 'editor'])`
  new RegExp(String.raw`\bhasRole\(\s*` + LIST, 'g'),
]

const STRING = /'([^'\n]*)'|"([^"\n]*)"/g

/**
 * The roles named in `source`'s role lists: SDL `@requireAuth(roles: ...)`,
 * `requireAuth({ roles })`, `hasRole(...)` and `<PrivateSet roles>` /
 * `<Private roles>`. Only string literals count, so a list built at runtime
 * adds nothing.
 */
export function rolesInSource(source: string): string[] {
  const roles = new Set<string>()

  for (const pattern of ROLE_LISTS) {
    for (const [, list] of source.matchAll(pattern)) {
      for (const [, single, double] of list.matchAll(STRING)) {
        const role = (single ?? double).trim()

        if (role) {
          roles.add(role)
        }
      }
    }
  }

  return [...roles]
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }

  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter(
      (file) =>
        SOURCE_FILE.test(file) &&
        !NOT_APP_CODE.test(file) &&
        !file.split(path.sep).includes('node_modules'),
    )
    .map((file) => path.join(dir, file))
}

/** The roles named in the role lists of every source file in `dirs`, sorted */
export function findRoles(dirs: string[]): string[] {
  const roles = new Set<string>()

  for (const file of dirs.flatMap(sourceFiles)) {
    for (const role of rolesInSource(fs.readFileSync(file, 'utf-8'))) {
      roles.add(role)
    }
  }

  return [...roles].sort()
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

// Setup formats the file afterwards, which picks the app's quotes
const key = (role: string) =>
  IDENTIFIER.test(role) ? role : JSON.stringify(role)

/**
 * The permissions package's `src/index.ts`: an entry with no permissions
 * for each of `roles`, or an example map when there are none
 */
export function permissionsIndexSource(template: string, roles: string[]) {
  const rolesComment =
    roles.length > 0
      ? [
          " * These are the roles the app's role lists name, with no",
          ' * permissions yet. Add the permissions each one needs, then guard',
          ' * fields with them instead of `roles`.',
        ].join('\n')
      : [
          ' * An example map: replace these permissions and roles with the',
          " * app's own.",
        ].join('\n')

  const definitions =
    roles.length > 0
      ? [
          '  permissions: [],',
          '  roles: {',
          ...roles.map((role) => `    ${key(role)}: [],`),
          '  },',
        ]
      : [
          "  permissions: ['posts.read', 'posts.edit'],",
          '  roles: {',
          "    editor: ['posts.read', 'posts.edit'],",
          "    reader: ['posts.read'],",
          '  },',
        ]

  return template
    .replace('__ROLES_COMMENT__', rolesComment)
    .replace('__DEFINITIONS__', definitions.join('\n'))
}
