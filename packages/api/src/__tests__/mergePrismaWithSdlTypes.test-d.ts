import { describe, expectTypeOf, test } from 'vitest'

import type {
  MakeRelationsOptional,
  MergePrismaWithSdlTypes,
} from '../types.js'

type Maybe<T> = T | null

// These are type aliases, not interfaces, like the types Prisma and GraphQL
// codegen generate. MergePrismaWithSdlTypes requires an index-signature
// compatible object type, which interfaces aren't

// The shape Prisma gives the `Organization` model
type PrismaOrganization = {
  id: string
  name: string
  email: string | null
}

// The shape GraphQL codegen gives the SDL `Organization` type
type Organization = {
  id: string
  name: string
  email?: Maybe<string>
  smsSenderDefault: string
  memberCount?: Maybe<number>
}

type AllMappedModels = Organization

type Mapped<TResolved extends PropertyKey = never> = MergePrismaWithSdlTypes<
  PrismaOrganization,
  MakeRelationsOptional<Organization, AllMappedModels>,
  AllMappedModels,
  TResolved
>

const prismaRow: PrismaOrganization = {
  id: 'org-1',
  name: 'Org',
  email: null,
}

describe('MergePrismaWithSdlTypes', () => {
  test('SDL-only fields are required when no field resolver provides them', () => {
    expectTypeOf<Mapped>().toEqualTypeOf<{
      id: string
      name: string
      email?: string | null
      smsSenderDefault: string
      memberCount?: Maybe<number>
    }>()

    expectTypeOf(prismaRow).not.toExtend<Mapped>()
  })

  test('SDL-only fields provided by a field resolver are optional', () => {
    expectTypeOf<Mapped<'smsSenderDefault'>>().toEqualTypeOf<{
      id: string
      name: string
      email?: string | null
      smsSenderDefault?: string
      memberCount?: Maybe<number>
    }>()

    expectTypeOf(prismaRow).toExtend<Mapped<'smsSenderDefault'>>()
  })

  test('Prisma fields stay required when a field resolver provides them', () => {
    expectTypeOf<Mapped<'name' | 'smsSenderDefault'>>().toEqualTypeOf<{
      id: string
      name: string
      email?: string | null
      smsSenderDefault?: string
      memberCount?: Maybe<number>
    }>()
  })

  test('Field resolver names that are not in the SDL are ignored', () => {
    expectTypeOf<Mapped<'notAField'>>().toEqualTypeOf<Mapped>()
  })
})
