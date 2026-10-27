import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { RuleTester } from '@typescript-eslint/rule-tester'
import { dedent } from 'ts-dedent'

import {
  parsePermissionNames,
  validPermissionNames,
} from '../valid-permission-names.js'

const ruleTester = new RuleTester()

// An app with a permissions package, one without, and one whose package
// doesn't declare its permissions in a way the rule can read
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valid-permission-names-'))

function writeApp(name: string, indexSource?: string) {
  const app = path.join(root, name)
  fs.mkdirSync(path.join(app, 'api', 'src', 'graphql'), { recursive: true })

  if (indexSource !== undefined) {
    const dir = path.join(app, 'packages', 'permissions', 'src')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.ts'), indexSource)
  }

  return path.join(app, 'api', 'src', 'graphql')
}

const sdlDir = writeApp(
  'tenant',
  dedent`
    import { definePermissions } from '@cedarjs/tenancy/permissions'

    export const permissions = definePermissions({
      permissions: ['organization.read', 'members.manage'],
      roles: { owner: ['organization.read', 'members.manage'] },
    })
  `,
)
const plainSdlDir = writeApp('plain')
const dynamicSdlDir = writeApp(
  'dynamic',
  dedent`
    import { definePermissions } from '@cedarjs/tenancy/permissions'
    const names = ['a.b']
    export const permissions = definePermissions({ permissions: names, roles: {} })
  `,
)
const brokenSdlDir = writeApp('broken', 'export const = ((')

const sdl = (directive: string) => dedent`
  export const schema = gql\`
    type Query {
      members: [String!]! ${directive}
    }
  \`
`

const sdlFile = (dir: string) => path.join(dir, 'members.sdl.ts')

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

ruleTester.run('valid-permission-names', validPermissionNames, {
  valid: [
    {
      filename: sdlFile(sdlDir),
      code: sdl('@requirePermission(permission: "members.manage")'),
    },
    {
      filename: path.join(sdlDir, 'members.sdl.js'),
      code: sdl('@requirePermission( permission : "organization.read" )'),
    },
    {
      // Not an SDL file
      filename: path.join(sdlDir, 'members.ts'),
      code: sdl('@requirePermission(permission: "nope")'),
    },
    {
      // No permissions package: an app without tenancy
      filename: sdlFile(plainSdlDir),
      code: sdl('@requirePermission(permission: "nope")'),
    },
    {
      // Permissions that aren't string literals
      filename: sdlFile(dynamicSdlDir),
      code: sdl('@requirePermission(permission: "nope")'),
    },
    {
      // A permissions file that doesn't parse
      filename: sdlFile(brokenSdlDir),
      code: sdl('@requirePermission(permission: "nope")'),
    },
    {
      // The file named in the options is missing
      filename: sdlFile(sdlDir),
      options: [{ permissionsFile: path.join(root, 'missing.ts') }],
      code: sdl('@requirePermission(permission: "nope")'),
    },
    {
      // An interpolation in the directive
      filename: sdlFile(sdlDir),
      code: 'export const schema = gql`type Query { a: String @requirePermission(permission: "${name}") }`',
    },
    {
      filename: sdlFile(sdlDir),
      code: 'export const schema = gql`type Query { a: String @requirePermission(permission: ${name}) }`',
    },
    {
      // A variable, not a literal
      filename: sdlFile(sdlDir),
      code: sdl('@requirePermission(permission: $permission)'),
    },
    {
      // A GraphQL comment
      filename: sdlFile(sdlDir),
      code: sdl('# @requirePermission(permission: "nope")'),
    },
    {
      // An example in a description is not a directive
      filename: sdlFile(sdlDir),
      code: dedent`
        export const schema = gql\`
          type Query {
            """
            Guarded with @requirePermission(permission: "example.read") in the
            "real" SDL.
            """
            a: String @requirePermission(permission: "members.manage")
            "Mentions # and @requirePermission(permission: \\"nope\\") too"
            b: String
          }
        \`
      `,
    },
    {
      // GraphQL allows commas and comments between the arguments
      filename: sdlFile(sdlDir),
      code: sdl(dedent`
        @requirePermission(
          permission: "members.manage", # the comma and this comment are fine
        )
      `),
    },
    {
      // Not a gql template
      filename: sdlFile(sdlDir),
      code: 'export const schema = sql`@requirePermission(permission: "nope")`',
    },
    {
      // Other directives are none of this rule's business
      filename: sdlFile(sdlDir),
      code: sdl('@requireAuth(roles: "nope")'),
    },
  ],
  invalid: [
    {
      filename: sdlFile(sdlDir),
      code: sdl('@requirePermission(permission: "other.thing")'),
      errors: [
        {
          messageId: 'unknownPermission',
          data: { name: 'other.thing' },
          line: 3,
          column: 57,
          endLine: 3,
          endColumn: 68,
        },
      ],
    },
    {
      // Commas and comments don't hide a typo
      filename: sdlFile(sdlDir),
      code: sdl(dedent`
        @requirePermission(
          permission: "members.manag", # comment
        )
      `),
      errors: [{ messageId: 'unknownPermissionWithSuggestion' }],
    },
    {
      filename: sdlFile(sdlDir),
      code: sdl('@requirePermission(permission: "members.manag")'),
      errors: [
        {
          messageId: 'unknownPermissionWithSuggestion',
          data: { name: 'members.manag', suggestion: 'members.manage' },
        },
      ],
    },
    {
      filename: path.join(sdlDir, 'members.sdl.js'),
      code: dedent`
        export const schema = gql\`
          type Query {
            a: String @requirePermission(permission: "organization.red")
            b: String @requirePermission(permission: "members.manage")
            c: String @requirePermission(permission: "zzz")
          }
        \`
      `,
      errors: [
        {
          message:
            'Unknown permission "organization.red". Did you mean "organization.read"?',
          line: 3,
        },
        {
          message:
            'Unknown permission "zzz". Add it to `permissions` in definePermissions(), or fix the name.',
          line: 5,
        },
      ],
    },
    {
      // The file is named in the options, not found from the SDL file
      filename: path.join(root, 'elsewhere.sdl.ts'),
      options: [
        {
          permissionsFile: path.join(
            root,
            'tenant',
            'packages',
            'permissions',
            'src',
            'index.ts',
          ),
        },
      ],
      code: sdl('@requirePermission(permission: "nope")'),
      errors: [{ messageId: 'unknownPermission' }],
    },
  ],
})

describe('parsePermissionNames', () => {
  it('reads the permissions array', () => {
    expect(
      parsePermissionNames(
        'definePermissions({ roles: {}, permissions: [\'a\', "b", `c`] })',
      ),
    ).toEqual(new Set(['a', 'b', 'c']))
  })

  it('sees through as const, satisfies and non-null assertions', () => {
    expect(
      parsePermissionNames(
        "definePermissions({ permissions: ['a' as const, 'b'!] as const satisfies readonly string[] })",
      ),
    ).toEqual(new Set(['a', 'b']))
  })

  it('gives up on anything it cannot read', () => {
    expect(parsePermissionNames('definePermissions({ roles: {} })')).toBeNull()
    expect(parsePermissionNames('foo({ permissions: ["a"] })')).toBeNull()
    expect(
      parsePermissionNames('definePermissions({ permissions: [...x] })'),
    ).toBeNull()
  })
})
