import { describe, expectTypeOf, test } from 'vitest'

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

describe('removeNulls', () => {
  test('RemoveNulls changes null to undefined in each field', () => {
    expectTypeOf<
      RemoveNulls<{ a: string | null; b?: number | null; c: boolean }>
    >().toEqualTypeOf<{
      a: string | undefined
      b?: number | undefined
      c: boolean
    }>()
  })

  test('removeNulls returns RemoveNulls of its input', () => {
    expectTypeOf(removeNulls(input)).toEqualTypeOf<
      RemoveNulls<UpdatePostInput>
    >()
  })

  test('the result can be passed to Prisma', () => {
    // @ts-expect-error - Prisma doesn't accept null for the required title
    updatePost({ data: input })

    updatePost({ data: removeNulls(input) })
    updatePost({ data: { ...removeNulls(input), bio: input.bio } })
  })

  test('the result is type checked against Prisma', () => {
    const wrongType = { title: 1 as number | null }

    // @ts-expect-error - title is a number, not a string
    updatePost({ data: removeNulls(wrongType) })

    // @ts-expect-error - titel is not a field on PostUpdateInput
    updatePost({ data: { ...removeNulls(input), titel: 'x' } })
  })

  test('RemoveNulls keeps arrays as arrays', () => {
    expectTypeOf(removeNulls([1, null])).toEqualTypeOf<(number | undefined)[]>()
  })
})
