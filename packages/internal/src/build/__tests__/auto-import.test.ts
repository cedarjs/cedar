import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import { applyAutoImports } from '../auto-import.js'

describe('applyAutoImports', () => {
  it('injects gql import when gql is used without declaration', () => {
    const code = dedent`
      export const handler = () => {
        return gql\`
          query { foo }
        \`
      }
    `

    const result = applyAutoImports(code)

    expect(result).toContain("import gql from 'graphql-tag'")
    expect(result).toContain(code.trim())
  })

  it('injects context import when context is used without declaration', () => {
    const code = dedent`
      export const handler = () => {
        return context.db
      }
    `

    const result = applyAutoImports(code)

    expect(result).toContain("import { context } from '@cedarjs/context'")
    expect(result).toContain(code.trim())
  })

  it('injects both imports when both are used without declaration', () => {
    const code = dedent`
      export const handler = () => {
        const user = context.db.user
        return gql\` { user }\`
      }
    `

    const result = applyAutoImports(code)

    expect(result).toContain("import gql from 'graphql-tag'")
    expect(result).toContain("import { context } from '@cedarjs/context'")
    expect(result).toContain(code.trim())
  })

  it('does not inject when already imported', () => {
    const code = dedent`
      import gql from 'graphql-tag'
      import { context } from '@cedarjs/context'

      export const handler = () => {
        return gql\` { user }\`
      }
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject gql when locally declared as a plain identifier', () => {
    const code = dedent`
      const gql = makeTag()
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject context when locally declared via object destructuring', () => {
    const code = dedent`
      const { context } = helpers
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject gql when it is one of multiple declarators', () => {
    const code = dedent`
      const unused = 1, gql = makeTag()
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject context when declared via an exported variable', () => {
    const code = dedent`
      export const context = {}
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject gql when declared via array destructuring', () => {
    const code = dedent`
      const [gql] = [makeTag()]
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject context when declared via object destructuring with alias', () => {
    const code = dedent`
      const { ctx: context } = helpers
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject gql when declared via rest pattern in array', () => {
    const code = dedent`
      const [first, ...gql] = arr
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('does not inject context when declared via rest pattern in object', () => {
    const code = dedent`
      const { a, ...context } = obj
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('injects gql when used as a tagged template inside a function with gql as a parameter (not caught by top-level binding check)', () => {
    const code = dedent`
      function foo(gql = defaultTag) {
        return gql\` { bar }\`
      }
    `

    const result = applyAutoImports(code)

    expect(result).toContain("import gql from 'graphql-tag'")
  })

  it('does not inject gql when declared as a function', () => {
    const code = dedent`
      function gql() {}
    `

    expect(applyAutoImports(code)).toBe(code)
  })

  it('returns code unchanged when neither name appears in the source', () => {
    const code = `export const handler = () => 42`

    expect(applyAutoImports(code)).toBe(code)
  })
})
