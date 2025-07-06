import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { cedarCellTransform } from '../vite-plugin-cedar-cell.js'

describe('redwoodCellTransform', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.mocked(console).warn.mockRestore()
  })

  const plugin = cedarCellTransform()

  it('should transform a basic cell with QUERY export', async () => {
    const input = `
      export const QUERY = gql\`
        query UserQuery($id: Int!) {
          user(id: $id) {
            id
            name
          }
        }
      \`

      export const Loading = () => <div>Loading...</div>

      export const Success = ({ user }) => {
        return <div>Hello {user.name}</div>
      }

      export const Failure = ({ error }) => {
        return <div>Error: {error.message}</div>
      }
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/UserCell.tsx')

    expect(result).toBeTruthy()
    expect(result.code).toContain('import { createCell } from "@cedarjs/web"')
    expect(result.code).toContain('export default createCell({')
    expect(result.code).toContain('QUERY,')
    expect(result.code).toContain('Loading,')
    expect(result.code).toContain('Success,')
    expect(result.code).toContain('Failure,')
    expect(result.code).toContain('displayName: "UserCell"')
  })

  it('should transform a server cell with data export', async () => {
    const input = `
      export const data = async ({ id }) => {
        return { user: { id, name: 'John' } }
      }

      export const Loading = () => <div>Loading...</div>

      export const Success = ({ user }) => {
        return <div>Hello {user.name}</div>
      }
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/ServerUserCell.tsx')

    expect(result).toBeTruthy()
    expect(result.code).toContain(
      'import { createServerCell } from "@cedarjs/web/dist/components/cell/createServerCell"',
    )
    expect(result.code).toContain('export default createServerCell({')
    expect(result.code).toContain('data,')
    expect(result.code).toContain('Loading,')
    expect(result.code).toContain('Success,')
    expect(result.code).toContain('displayName: "ServerUserCell"')
  })

  it('should not transform files that do not end with Cell', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`
      export const Success = ({ users }) => <div>{users.length}</div>
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/UserComponent.tsx')

    expect(result).toBeNull()
  })

  it('should not transform cells that already have a default export', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`
      export const Success = ({ users }) => <div>{users.length}</div>
      export default function MyCell() { return null }
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/MyCell.tsx')

    expect(result).toBeNull()
  })

  it('should not transform files without QUERY or data exports', async () => {
    const input = `
      export const Loading = () => <div>Loading...</div>
      export const Success = () => <div>Success</div>
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/NotACell.tsx')

    expect(result).toBeNull()
  })

  it('should handle function declarations', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`

      export function Loading() {
        return <div>Loading...</div>
      }

      export function Success({ users }) {
        return <div>{users.length}</div>
      }

      export function Failure({ error }) {
        return <div>Error: {error.message}</div>
      }
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/UsersCell.tsx')

    expect(result).toBeTruthy()
    expect(result.code).toContain('import { createCell } from "@cedarjs/web"')
    expect(result.code).toContain('export default createCell({')
    expect(result.code).toContain('QUERY,')
    expect(result.code).toContain('Loading,')
    expect(result.code).toContain('Success,')
    expect(result.code).toContain('Failure,')
    expect(result.code).toContain('displayName: "UsersCell"')
  })

  it('should handle all possible cell exports', async () => {
    const input = `
      export const beforeQuery = (props) => ({ ...props, enhanced: true })
      export const QUERY = gql\`query { users { id } }\`
      export const isEmpty = (data) => !data.users.length
      export const afterQuery = (data) => ({ ...data, processed: true })
      export const Loading = () => <div>Loading...</div>
      export const Success = ({ users }) => <div>{users.length}</div>
      export const Failure = ({ error }) => <div>Error</div>
      export const Empty = () => <div>No data</div>
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/CompleteCell.tsx')

    expect(result).toBeTruthy()
    expect(result.code).toContain('beforeQuery,')
    expect(result.code).toContain('QUERY,')
    expect(result.code).toContain('isEmpty,')
    expect(result.code).toContain('afterQuery,')
    expect(result.code).toContain('Loading,')
    expect(result.code).toContain('Success,')
    expect(result.code).toContain('Failure,')
    expect(result.code).toContain('Empty,')
    expect(result.code).toContain('displayName: "CompleteCell"')
  })

  it('should handle cells with .js extension', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`
      export const Success = ({ users }) => <div>{users.length}</div>
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/UsersCell.js')

    expect(result).toBeTruthy()
    expect(result.code).toContain('displayName: "UsersCell"')
  })

  it('should handle cells with .jsx extension', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`
      export const Success = ({ users }) => <div>{users.length}</div>
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/UsersCell.jsx')

    expect(result).toBeTruthy()
    expect(result.code).toContain('displayName: "UsersCell"')
  })

  it('should gracefully handle parse errors', async () => {
    const input = `
      export const QUERY = gql\`query { users { id } }\`
      export const Success = ({ users }) => <div>{users.length}</div>
      // This is invalid syntax
      export const Invalid = {{{
    `

    // @ts-expect-error The PluginOption type doesn't guarantee transform method exists
    const result = await plugin.transform(input, '/path/to/BrokenCell.tsx')

    expect(result).toBeNull()
  })
})
