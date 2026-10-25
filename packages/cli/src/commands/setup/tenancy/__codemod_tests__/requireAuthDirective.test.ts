import fs from 'node:fs'
import path from 'node:path'

import { parse } from 'graphql'
import { describe, expect, it } from 'vitest'

import { addScopeToRequireAuthDirective } from '../requireAuthDirective.js'

const TEMPLATES = path.join(
  import.meta.dirname,
  '../../../../../../create-cedar-app/templates',
)

const read = (lang: 'ts' | 'js') =>
  fs.readFileSync(
    path.join(
      TEMPLATES,
      lang,
      `api/src/directives/requireAuth/requireAuth.${lang}`,
    ),
    'utf-8',
  )

describe('addScopeToRequireAuthDirective', () => {
  it('adds the scope argument to the generated TypeScript directive', () => {
    const result = addScopeToRequireAuthDirective(read('ts'))

    expect(result).toContain('enum AuthScope {')
    expect(result).toContain('scope: AuthScope = ORGANIZATION')
    expect(result).toContain(
      'ValidatorDirectiveFunc<{ roles?: string[]; scope?: AuthScope }>',
    )
    expect(result).toContain(
      "import type { AuthScope } from '@cedarjs/tenancy'",
    )
    expect(result).toContain('const { roles, scope } = directiveArgs')
    expect(result).toContain('applicationRequireAuth({ roles, scope })')
  })

  it('keeps the SDL valid, with the description on the directive', () => {
    const result = addScopeToRequireAuthDirective(read('ts'))
    const sdl = result.match(/gql`([\s\S]*?)`/)?.[1] ?? ''
    const [directive, scopeEnum] = parse(sdl).definitions

    expect(directive).toMatchObject({
      kind: 'DirectiveDefinition',
      description: { value: expect.stringContaining('Use to check') },
    })
    expect(scopeEnum).toMatchObject({ kind: 'EnumTypeDefinition' })
  })

  it('adds the scope argument to the generated JavaScript directive', () => {
    const result = addScopeToRequireAuthDirective(read('js'))

    expect(result).toContain('scope: AuthScope = ORGANIZATION')
    expect(result).toContain('applicationRequireAuth({ roles, scope })')
    expect(result).not.toContain('@cedarjs/tenancy')
  })

  it('changes nothing the second time', () => {
    const once = addScopeToRequireAuthDirective(read('ts'))

    expect(addScopeToRequireAuthDirective(once)).toBe(once)
  })

  it('throws when the directive has been changed', () => {
    expect(() =>
      addScopeToRequireAuthDirective(
        read('ts').replace('applicationRequireAuth({ roles })', 'check(roles)'),
      ),
    ).toThrow('CEDAR_TENANCY_ERR_DIRECTIVE_SHAPE_NOT_FOUND')
  })
})
