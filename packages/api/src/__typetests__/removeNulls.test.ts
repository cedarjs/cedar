import { expect, test } from 'tstyche'

import { removeNulls } from '../transforms.js'
import type { RemoveNulls } from '../transforms.js'

type InputMaybe<T> = T | null

type InputJsonValue =
  | string
  | number
  | boolean
  | { readonly [key: string]: InputJsonValue | null }
  | readonly (InputJsonValue | null)[]

// The shape GraphQL codegen gives an `UpdatePostInput`
interface UpdatePostInput {
  title?: InputMaybe<string>
  bio?: InputMaybe<string>
  meta?: InputMaybe<InputJsonValue>
}

// The shape Prisma gives `Prisma.PostUpdateInput`
interface PostUpdateInput {
  title?: string | { set?: string }
  bio?: string | null | { set?: string | null }
  meta?: InputJsonValue
}

declare function updatePost(args: { data: PostUpdateInput }): void

declare const input: UpdatePostInput

test('RemoveNulls changes null to undefined in each field', () => {
  expect<
    RemoveNulls<{ a: string | null; b?: number | null; c: boolean }>
  >().type.toBe<{ a: string | undefined; b?: number | undefined; c: boolean }>()
})

test('removeNulls returns RemoveNulls of its input', () => {
  expect(removeNulls(input)).type.toBe<RemoveNulls<UpdatePostInput>>()
})

test('the result can be passed to Prisma', () => {
  expect(updatePost({ data: input })).type.toRaiseError()
  expect(updatePost({ data: removeNulls(input) })).type.not.toRaiseError()
  expect(
    updatePost({ data: { ...removeNulls(input), bio: input.bio } }),
  ).type.not.toRaiseError()
})

test('the result is type checked against Prisma', () => {
  const wrongType = { title: 1 as number | null }

  expect(updatePost({ data: removeNulls(wrongType) })).type.toRaiseError()
  expect(
    updatePost({ data: { ...removeNulls(input), titel: 'x' } }),
  ).type.toRaiseError()
})

test('RemoveNulls keeps arrays as arrays', () => {
  expect(removeNulls([1, null])).type.toBe<(number | undefined)[]>()
})
