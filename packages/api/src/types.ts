/**
 * Houses utility types commonly used on the api side
 */

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
type SdlOnlyFields<TPrisma, TSdl> = Omit<TSdl, keyof TPrisma>

type PrismaTypeWithOptionalKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, OptionalKeys<TSdl>>

type PrismaTypeWithOptionalKeysAndNullableValues<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = {
  [k in keyof PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>]?:
    | PrismaTypeWithOptionalKeysFromSdl<TPrisma, TSdl>[k]
    | null
}

type PrismaTypeWithRequiredKeysFromSdl<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = Pick<TPrisma, RequiredKeys<TSdl>>

type OptionalsAndSdlOnly<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
> = PrismaTypeWithOptionalKeysAndNullableValues<TPrisma, TSdl> &
  SdlOnlyFields<TPrisma, TSdl>

type UnwrapMaybe<T> = T extends null | undefined ? never : T
type UnwrapArray<T> = T extends (infer U)[] ? U : T
type BaseType<T> = UnwrapMaybe<UnwrapArray<UnwrapMaybe<T>>>

export type MakeRelationsOptional<T, TAllMappedModels> = {
  [key in keyof T as BaseType<T[key]> extends TAllMappedModels
    ? key
    : never]?: MakeRelationsOptional<T[key], TAllMappedModels>
} & {
  [key in keyof T as BaseType<T[key]> extends TAllMappedModels
    ? never
    : key]: T[key]
}

// Note: don't use O.Merge here, because it results in unknowns
type MergePrismaWithSdlTypesInner<
  TPrisma extends AnyObject,
  TProcessedSdl extends AnyObject,
> = Compute<
  OptionalsAndSdlOnly<TPrisma, TProcessedSdl> &
    PrismaTypeWithRequiredKeysFromSdl<TPrisma, TProcessedSdl>
>

export type MergePrismaWithSdlTypes<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TAllMappedModels,
> = MergePrismaWithSdlTypesInner<
  TPrisma,
  MakeRelationsOptional<TSdl, TAllMappedModels>
>

export type MergePrismaWithSdlTypesWithKnownRelations<
  TPrisma extends AnyObject,
  TSdl extends AnyObject,
  TRelationKeys extends keyof TSdl,
> = MergePrismaWithSdlTypesInner<
  TPrisma,
  Omit<TSdl, TRelationKeys> & Partial<Pick<TSdl, TRelationKeys>>
>
// ---- Prisma SDL Type Merge ----
