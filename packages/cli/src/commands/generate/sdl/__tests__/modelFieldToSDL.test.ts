import { describe, test, expect } from 'vitest'

import { modelFieldToSDL } from '../sdlHandler.js'

const field = (
  overrides: Partial<Parameters<typeof modelFieldToSDL>[0]['field']>,
) => ({
  name: 'field',
  type: 'String',
  kind: 'scalar',
  isList: false,
  isRequired: true,
  isId: false,
  ...overrides,
})

describe('modelFieldToSDL', () => {
  test('scalar lists have non-nullable items', () => {
    expect(
      modelFieldToSDL({ field: field({ name: 'tags', isList: true }) }),
    ).toEqual('tags: [String!]!')
  })

  test('enum lists have non-nullable items', () => {
    expect(
      modelFieldToSDL({
        field: field({
          name: 'roles',
          type: 'Role',
          kind: 'enum',
          isList: true,
        }),
      }),
    ).toEqual('roles: [Role!]!')
  })

  test('scalar lists in optional inputs have non-nullable items', () => {
    expect(
      modelFieldToSDL({
        field: field({ name: 'scores', type: 'Int', isList: true }),
        required: false,
      }),
    ).toEqual('scores: [Int!]!')
  })

  test('relation lists keep nullable items', () => {
    expect(
      modelFieldToSDL({
        field: field({
          name: 'posts',
          type: 'Post',
          kind: 'object',
          isList: true,
        }),
      }),
    ).toEqual('posts: [Post]!')
  })
})
