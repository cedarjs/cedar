/**
 * Houses utility types commonly used on the api side
 */

// ---- Native replacements for ts-toolbelt (Proposal 5) ----
type OptionalKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never
}[keyof T]

type RequiredKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]

type Compute<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

/**
 * ---- Prisma SDL Type Merge ----
 * SDL is source of truth for KEYS
 * Prisma types is source of truth for VALUES (unless SDL-only field)
 */

type AnyObject = Record<string | symbol | number, unknown>
// Pick out unique keys on the SDL type
type SdlOnlyFields<TPrisma, TSdl> = Omit<TSdl, keyof TPrisma>

// Object with all the optional keys, so that we can make them nullable
type PrismaTypeWithOptionalKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, OptionalKeys<TSdl>>

// Make the optional values nullable
type PrismaTypeWithOptionalKeysAndNullableValues<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = {
  [k in keyof PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>]?:
    | PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>[k]
    | null // Note: if we ever change the type of Maybe in codegen, it might be worth changing this to Maybe<T>
}

// Object with all the required keys
type PrismaTypeWithRequiredKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, RequiredKeys<TSdl>>

// To replace the unknowns with types from Sdl on SDL-only fields
type OptionalsAndSdlOnly<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = PrismaTypeWithOptionalKeysAndNullableValues<TPrisma, TSdl> &
  SdlOnlyFields<TPrisma, TSdl>

// ---- Unwrap helpers for relation detection (Proposal 3) ----
type UnwrapMaybe<T> = T extends null | undefined ? never : T
type UnwrapArray<T> = T extends (infer U)[] ? U : T
type BaseType<T> = UnwrapMaybe<UnwrapArray<UnwrapMaybe<T>>>

export type MakeRelationsOptional<T, TAllMappedModels> = {
  // object with optional relation keys
  [key in keyof T as BaseType<T[key]> extends TAllMappedModels
    ? key
    : never]?: MakeRelationsOptional<T[key], TAllMappedModels>
} & {
  // object without the relation keys
  [key in keyof T as BaseType<T[key]> extends TAllMappedModels
    ? never
    : key]: T[key]
}

// ⚡ All together now
// Note: don't use O.Merge here, because it results in unknowns

// Intermediate type to evaluate MakeRelationsOptional once (Proposal 2)
type MergePrismaWithSdlTypesInner<
  TPrisma extends AnyObject,
  TProcessedSdl extends AnyObject,
> = Compute<
  OptionalsAndSdlOnly<TPrisma, TProcessedSdl> &
    PrismaTypeWithRequiredKeysFromSdl<TPrisma, TProcessedSdl>
>

// Proposals 1 (flat Compute), 2 (cached MakeRelationsOptional), 3 (BaseType), 5 (no ts-toolbelt)
export type MergePrismaWithSdlTypes<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TAllMappedModels,
> = MergePrismaWithSdlTypesInner<
  TPrisma,
  MakeRelationsOptional<TSdl, TAllMappedModels>
>

// Optimized variant with pre-computed relation keys (Proposal 4)
// Eliminates MakeRelationsOptional and AllMappedModels entirely
export type MergePrismaWithSdlTypesWithKnownRelations<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TRelationKeys extends keyof TSdl,
> = MergePrismaWithSdlTypesInner<
  TPrisma,
  Omit<TSdl, TRelationKeys> & Partial<Pick<TSdl, TRelationKeys>>
>
// ---- Prisma SDL Type Merge ----
