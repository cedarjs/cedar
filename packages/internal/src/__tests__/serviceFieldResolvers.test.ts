import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parse } from '@babel/parser'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  getFieldResolversFromAst,
  getServiceFieldResolvers,
} from '../generate/serviceFieldResolvers.js'

const parseTs = (code: string) => {
  return parse(code, { sourceType: 'module', plugins: ['typescript'] })
}

describe('getFieldResolversFromAst', () => {
  test('finds the keys of exported type objects', () => {
    const ast = parseTs(`
      import type { OrganizationRelationResolvers } from 'types/graphql'

      export const myOrganization = () => db.organization.findFirst()

      export const Organization: OrganizationRelationResolvers = {
        smsSenderDefault: (_args, { root }) => smsSenderName(root.name),
        members() {
          return []
        },
        'quoted': () => 'quoted',
      }
    `)

    expect(getFieldResolversFromAst(ast)).toEqual({
      Organization: ['smsSenderDefault', 'members', 'quoted'],
    })
  })

  test('unwraps satisfies and as expressions', () => {
    const ast = parseTs(`
      export const Post = {
        author: () => null,
      } satisfies PostRelationResolvers

      export const User = ({ posts: () => [] }) as UserRelationResolvers
    `)

    expect(getFieldResolversFromAst(ast)).toEqual({
      Post: ['author'],
      User: ['posts'],
    })
  })

  test('skips root types, spreads, computed keys and non-objects', () => {
    const ast = parseTs(`
      const shared = { a: () => 1 }
      const key = 'b'

      export const Query = { posts: () => [] }
      export const Mutation = { createPost: () => null }
      export const Post = {
        ...shared,
        [key]: () => 2,
        title: () => 'title',
      }
      export const posts = () => []
      export const NotAnObject = makeResolvers()
    `)

    expect(getFieldResolversFromAst(ast)).toEqual({
      Post: ['title'],
    })
  })
})

describe('getServiceFieldResolvers', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-field-resolvers-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('merges, sorts and de-duplicates fields across services', () => {
    const postsFile = path.join(tmpDir, 'posts.ts')
    const commentsFile = path.join(tmpDir, 'comments.js')

    fs.writeFileSync(
      postsFile,
      `export const Post = { title: () => '', author: () => null }`,
    )
    fs.writeFileSync(
      commentsFile,
      `export const Post = { comments: () => [], author: () => null }
       export const Comment = { post: () => null }`,
    )

    expect(getServiceFieldResolvers([postsFile, commentsFile])).toEqual({
      Comment: ['post'],
      Post: ['author', 'comments', 'title'],
    })
  })
})
