import path from 'node:path'

import { vol } from 'memfs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { cedarMockCellDataPlugin } from '../vite-plugin-cedar-mock-cell-data.js'

vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))
vi.mock('fast-glob', async () => {
  const { vol } = await import('memfs')
  return {
    default: {
      sync: (pattern: string, opts: { cwd: string; absolute: boolean }) => {
        // Simple glob: find files matching the pattern in cwd
        const files = Object.keys(vol.toJSON() ?? {})
        const cwd = opts.cwd.replace(/\\/g, '/')
        const name = pattern.replace('.{js,jsx,ts,tsx}', '')
        return files.filter((f) => {
          const normalized = f.replace(/\\/g, '/')
          return (
            normalized.startsWith(cwd) &&
            /\.(js|jsx|ts|tsx)$/.test(normalized) &&
            path.basename(normalized, path.extname(normalized)) === name
          )
        })
      },
    },
  }
})

const CELL_DIR = '/app/web/src/components/UserCell'
const MOCK_FILE = `${CELL_DIR}/UserCell.mock.ts`
const CELL_FILE = `${CELL_DIR}/UserCell.tsx`

const CELL_WITH_QUERY = `
export const QUERY = gql\`
  query FindUserById($id: Int!) {
    user: user(id: $id) {
      id
    }
  }
\`

export const Loading = () => <div>Loading...</div>
export const Success = ({ user }) => <div>{user.id}</div>
`

const CELL_WITH_QUERY_AND_AFTER_QUERY = `
export const QUERY = gql\`
  query FindUserById($id: Int!) {
    user: user(id: $id) {
      id
    }
  }
\`

export const afterQuery = (data) => ({ ...data, formatted: true })
export const Loading = () => <div>Loading...</div>
export const Success = ({ user }) => <div>{user.id}</div>
`

const CELL_WITH_DEFAULT_EXPORT = `
const MyCell = () => <div>Default export cell</div>
export default MyCell
`

const CELL_WITHOUT_QUERY = `
export const Loading = () => <div>Loading...</div>
export const Success = ({ user }) => <div>{user.id}</div>
`

const MOCK_ARROW = `
export const standard = () => ({ id: 42 })
`

const MOCK_FUNCTION = `
export function standard() {
  return { id: 42 }
}
`

const MOCK_WITH_OTHER_EXPORT = `
export const notStandard = () => ({ id: 42 })
export const other = 'hello'
`

describe('cedarMockCellDataPlugin', () => {
  const plugin = cedarMockCellDataPlugin()

  beforeEach(() => {
    vol.reset()
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    vol.reset()
  })

  it('returns null for non-mock files', async () => {
    // @ts-expect-error Plugin type
    const result = await plugin.transform(
      MOCK_ARROW,
      '/app/components/UserCell/UserCell.ts',
    )
    expect(result).toBeNull()
  })

  it('returns null for .mock.jsx files (not in original pattern)', async () => {
    // @ts-expect-error Plugin type
    const result = await plugin.transform(
      MOCK_ARROW,
      `${CELL_DIR}/UserCell.mock.jsx`,
    )
    expect(result).toBeNull()
  })

  it('returns null in production environment', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY })
    process.env.NODE_ENV = 'production'
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).toBeNull()
    process.env.NODE_ENV = 'test'
  })

  it('returns null when no adjacent cell file is found', async () => {
    // No cell file in the volume
    vol.fromJSON({})
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).toBeNull()
  })

  it('returns null when adjacent cell has a default export', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_DEFAULT_EXPORT })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).toBeNull()
  })

  it('returns null when adjacent cell has no QUERY export', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITHOUT_QUERY })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).toBeNull()
  })

  it('returns null when mock file has no standard export', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_WITH_OTHER_EXPORT, MOCK_FILE)
    expect(result).toBeNull()
  })

  it('transforms arrow function standard export into mockGraphQLQuery', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).not.toBeNull()
    expect(result?.code).toContain('mockGraphQLQuery')
    expect(result?.code).toContain('"FindUserById"')
    expect(result?.code).toContain('export const standard')
    // Should NOT have the original simple arrow function anymore
    expect(result?.code).not.toMatch(/export const standard = \(\) =>/)
  })

  it('transforms function declaration standard export into mockGraphQLQuery', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_FUNCTION, MOCK_FILE)
    expect(result).not.toBeNull()
    expect(result?.code).toContain('mockGraphQLQuery')
    expect(result?.code).toContain('"FindUserById"')
    expect(result?.code).toContain('export const standard')
  })

  it('wraps with afterQuery when the cell exports afterQuery', async () => {
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY_AND_AFTER_QUERY })
    // @ts-expect-error Plugin type
    const result = await plugin.transform(MOCK_ARROW, MOCK_FILE)
    expect(result).not.toBeNull()
    expect(result?.code).toContain('mockGraphQLQuery')
    expect(result?.code).toContain('afterQuery')
    expect(result?.code).toContain(`import { afterQuery }`)
    expect(result?.code).toContain('UserCell.tsx')
  })

  it('throws when standard export is not a function', () => {
    const MOCK_NON_FUNCTION = `export const standard = { id: 42 }`
    vol.fromJSON({ [CELL_FILE]: CELL_WITH_QUERY })
    expect(() => {
      // @ts-expect-error Plugin type
      plugin.transform(MOCK_NON_FUNCTION, MOCK_FILE)
    }).toThrow('Mock Error')
  })
})
