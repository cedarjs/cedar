/**
 * Houses utility types commonly used on the api side
 */

import type { O, A } from 'ts-toolbelt'

/**
 * ---- Prisma SDL Type Merge ----
 * SDL is source of truth for KEYS
 * Prisma types is source of truth for VALUES (unless SDL-only field)
 */

type AnyObject = Record<string | symbol | number, unknown>
// Pick out unique keys on the SDL type. SDL-only keys listed in TResolved are
// computed by a field resolver on the type, so resolvers that return the type
// don't have to include them
type SdlOnlyFields<TPrisma, TSdl, TResolved extends PropertyKey> = Omit<
  TSdl,
  keyof TPrisma | TResolved
> & {
  [k in Exclude<Extract<keyof TSdl, TResolved>, keyof TPrisma>]?: TSdl[k]
}

// Object with all the optional keys, so that we can make them nullable
type PrismaTypeWithOptionalKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, O.OptionalKeys<TSdl>>

// Make the optional values nullable
type PrismaTypeWithOptionalKeysAndNullableValues<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = {
  [k in keyof PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>]?:
    PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>[k] | null // Note: if we ever change the type of Maybe in codegen, it might be worth changing this to Maybe<T>
}

// Object with all the required keys that Prisma has. Required SDL-only keys
// come from SdlOnlyFields
type PrismaTypeWithRequiredKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, Extract<O.RequiredKeys<TSdl>, keyof TPrisma>>

// To replace the unknowns with types from Sdl on SDL-only fields
type OptionalsAndSdlOnly<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TResolved extends PropertyKey,
> = PrismaTypeWithOptionalKeysAndNullableValues<TPrisma, TSdl> &
  SdlOnlyFields<TPrisma, TSdl, TResolved>

export type MakeRelationsOptional<T, TAllMappedModels> = {
  //object with optional relation keys
  [
    key in keyof T as T[key] extends TAllMappedModels ? key : never
  ]?: MakeRelationsOptional<T[key], TAllMappedModels>
} & {
  // object without the relation keys
  [key in keyof T as T[key] extends TAllMappedModels ? never : key]: T[key]
}

// ⚡ All together now
// Note: don't use O.Merge here, because it results in unknowns
/**
 * The type resolvers return for a GraphQL type that's backed by a Prisma model.
 *
 * `TResolved` is the union of field names the type's field resolvers (the
 * service export named after the type) provide. SDL-only fields in that union
 * are optional. Fields that also exist on the Prisma model stay as Prisma
 * types them, because their field resolvers read them from `root`.
 */
export type MergePrismaWithSdlTypes<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TAllMappedModels,
  TResolved extends PropertyKey = never,
> = A.Compute<
  OptionalsAndSdlOnly<
    TPrisma,
    MakeRelationsOptional<TSdl, TAllMappedModels>,
    TResolved
  > &
    PrismaTypeWithRequiredKeysFromSdl<
      TPrisma,
      MakeRelationsOptional<TSdl, TAllMappedModels>
    >
>
// ---- Prisma SDL Type Merge ----
