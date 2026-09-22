import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { getParsedScalarsCacheConfig } from '../generate/parsedScalars.js'

const schema = buildSchema(`
  scalar DateTime
  scalar JSON

  type Post {
    id: Int!
    title: String!
    postedAt: DateTime!
    editedAt: DateTime
    reminders: [DateTime!]!
    schedule: [[DateTime]]
    meta: JSON
  }

  type Comment {
    body: String!
  }

  type Query {
    posts: [Post!]!
    serverTime: DateTime!
  }

  input MetaInput {
    seenAt: [DateTime!]
  }

  input CreatePostInput {
    title: String!
    postedAt: DateTime!
    meta: MetaInput
    history: [MetaInput!]
  }

  input WrapperInput {
    post: CreatePostInput!
  }

  input FilterInput {
    title: String
    meta: JSON
  }
`)

describe('getParsedScalarsCacheConfig', () => {
  it('finds no fields when no scalar is parsed', () => {
    expect(getParsedScalarsCacheConfig(schema, {})).toEqual({
      scalars: {},
      typePolicies: {},
      inputObjects: {},
    })
  })

  describe('with DateTime parsed', () => {
    const config = getParsedScalarsCacheConfig(schema, { DateTime: 'Date' })

    it('passes the scalars on', () => {
      expect(config.scalars).toEqual({ DateTime: 'Date' })
    })

    it('finds the fields that hold the scalar, whatever their nullability or nesting', () => {
      expect(config.typePolicies).toEqual({
        Post: {
          fields: {
            postedAt: { scalar: 'DateTime' },
            editedAt: { scalar: 'DateTime' },
            reminders: { scalar: '[DateTime]' },
            schedule: { scalar: '[[DateTime]]' },
          },
        },
        Query: { fields: { serverTime: { scalar: 'DateTime' } } },
      })
    })

    it('leaves out fields that hold another scalar and types without the scalar', () => {
      expect(config.typePolicies.Post.fields).not.toHaveProperty('meta')
      expect(config.typePolicies).not.toHaveProperty('Comment')
    })

    it('finds the input objects that hold the scalar directly or through another input object', () => {
      expect(config.inputObjects).toEqual({
        MetaInput: { fields: { seenAt: '[DateTime]' } },
        CreatePostInput: {
          fields: {
            postedAt: 'DateTime',
            meta: 'MetaInput',
            history: '[MetaInput]',
          },
        },
        WrapperInput: { fields: { post: 'CreatePostInput' } },
      })
    })

    it('leaves out input objects without the scalar', () => {
      expect(config.inputObjects).not.toHaveProperty('FilterInput')
    })
  })

  it('ignores introspection types', () => {
    const config = getParsedScalarsCacheConfig(schema, { DateTime: 'Date' })

    expect(Object.keys(config.typePolicies)).not.toContainEqual(
      expect.stringMatching(/^__/),
    )
  })
})
