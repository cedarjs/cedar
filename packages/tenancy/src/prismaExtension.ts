import { Prisma as PrismaExtension } from '@prisma/client/extension'

import { context } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'

import { getCurrentOrg } from './context.js'
import { TenantScopeError } from './errors.js'

type FilterOutDollarPrefixed<T> = T extends `$${string}`
  ? never
  : T extends symbol // Remove symbol here, because it doesn't help users
    ? never
    : T

/**
 * The Prisma Client's model accessor names (`project`, `organization`, ...),
 * excluding client-level members like `$transaction` and `$extends`.
 */
export type ModelNamesFor<TClient> = FilterOutDollarPrefixed<keyof TClient>

export interface TenancyConfig<TClient> {
  /**
   * The column name on every tenant-owned model that stores the
   * organization id. Default: `'organizationId'`.
   */
  tenantField?: string
  /**
   * Either the exact list of tenant-owned models, or every model except the
   * ones listed in `allExcept`. `allExcept` is the safer default for an app:
   * a model added later is scoped automatically instead of silently staying
   * unscoped because it was never added to an explicit list. Cedar's own
   * `RW_DataMigration` model is never tenant-owned in either form.
   */
  models: ModelNamesFor<TClient>[] | { allExcept: ModelNamesFor<TClient>[] }
  /**
   * Returns the current tenant id, or `undefined` when none is in scope.
   * Default: reads `context.currentOrg?.id` from `@cedarjs/context`.
   */
  getTenantId?: () => string | undefined
}

/**
 * A single field entry from Prisma's runtime data model. The `prisma-client`
 * generator's compact runtime data model records only these four properties
 * per field — notably not `isList`, `isRequired`, `relationFromFields`, or
 * `relationToFields` — so relation cardinality has to be derived rather than
 * read directly; see `isListRelationField` below.
 */
interface RuntimeField {
  name: string
  kind: 'scalar' | 'object' | 'enum'
  type: string
  relationName?: string
}

interface RuntimeModel {
  fields: RuntimeField[]
}

interface RuntimeDataModel {
  models: Record<string, RuntimeModel>
}

interface ClientWithRuntimeDataModel {
  _runtimeDataModel: RuntimeDataModel
}

/**
 * Reads the Prisma Client's internal runtime data model, the source of
 * truth this extension uses to find relation fields and their target
 * models without any configuration from the app. `_runtimeDataModel` isn't
 * part of Prisma's public API, so this is checked at runtime rather than
 * assumed: an incompatible `@prisma/client` version fails loudly here
 * instead of silently scoping nothing.
 */
function getRuntimeDataModel(client: unknown): RuntimeDataModel {
  const candidate = client as Partial<ClientWithRuntimeDataModel>

  if (
    !candidate._runtimeDataModel ||
    typeof candidate._runtimeDataModel !== 'object' ||
    typeof candidate._runtimeDataModel.models !== 'object'
  ) {
    throw new Error(
      '@cedarjs/tenancy could not find a `_runtimeDataModel` on this Prisma ' +
        'Client. createTenancyExtension() reads it to discover relations ' +
        'between models; check that the installed `@prisma/client` version ' +
        'supports Client Extensions (`$extends`).',
    )
  }

  return candidate._runtimeDataModel
}

interface ClientWithEngineConfig {
  _engineConfig?: { inlineSchema?: unknown }
}

/**
 * Reads the `.prisma` schema source the client was generated from.
 * `prisma-client` embeds it verbatim on the client instance so the query
 * compiler can use it; it's copied there from `PrismaClientOptions` as
 * `client._engineConfig.inlineSchema`. Like `_runtimeDataModel`, this isn't
 * part of Prisma's public API, so a missing or non-string value is treated
 * as "unavailable" rather than an error — callers fall back to a heuristic
 * instead (see `isListRelationField`).
 */
function getInlineSchemaText(client: unknown): string | undefined {
  const candidate = client as Partial<ClientWithEngineConfig>
  const inlineSchema = candidate._engineConfig?.inlineSchema
  return typeof inlineSchema === 'string' ? inlineSchema : undefined
}

/**
 * Locates one `model <modelName> { ... }` block in `schemaText`, returning
 * the index range of its body (the text between the braces), or `null` when
 * there is no such model. The closing brace is found by counting brace
 * depth from the opening one — rather than matching up to the first `}`,
 * which a quoted attribute value (`@default("{}")`) or a `//` comment can
 * contain before the model actually ends — so a `"` or `'` opens a string
 * that braces inside it don't affect, and a `//` outside a string comments
 * out the rest of the line. Identical in technique to `findModelBlock` in
 * `packages/cli/src/commands/setup/tenancy/schemaPrisma.ts`, which solves
 * the same problem for schema-editing; not shared as an import, since that
 * is a CLI-only package and this runs at request time in an app.
 */
function findModelBodyRange(
  schemaText: string,
  searchFrom: number,
): { modelName: string; bodyStart: number; bodyEnd: number } | null {
  const headerPattern = /model\s+(\w+)\s*\{/g
  headerPattern.lastIndex = searchFrom
  const headerMatch = headerPattern.exec(schemaText)

  if (!headerMatch) {
    return null
  }

  const modelName = headerMatch[1]
  const bodyStart = headerMatch.index + headerMatch[0].length
  let depth = 1
  let index = bodyStart
  let quote: '"' | "'" | undefined

  for (; index < schemaText.length && depth > 0; index++) {
    const char = schemaText[index]

    if (quote) {
      if (char === '\\') {
        // Skip an escaped character inside the string (e.g. `\"`) so it
        // can't be mistaken for the closing quote.
        index++
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '/' && schemaText[index + 1] === '/') {
      // A line comment outside a string: skip to (but not past) the
      // newline, so a `}` in the comment text isn't counted.
      const newlineIndex = schemaText.indexOf('\n', index)
      index = newlineIndex === -1 ? schemaText.length : newlineIndex - 1
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
    }
  }

  if (depth !== 0) {
    return null
  }

  return { modelName, bodyStart, bodyEnd: index - 1 }
}

/**
 * The result of line-parsing one model body: which field names were
 * actually read off a line (`knownFields`), and which of those declared a
 * type ending in `[]` (`listFields`, always a subset of `knownFields`).
 * `knownFields` is what lets `isListRelationField` tell "this field is
 * to-one" apart from "this field was never classified" — see there.
 */
interface ParsedModelFields {
  knownFields: Set<string>
  listFields: Set<string>
}

/**
 * Parses `model X { ... }` blocks out of a `.prisma` schema source and
 * returns, per model, which fields were read off a line and which of those
 * are lists (type ending in `[]`) — the exact list-cardinality signal
 * Prisma's compact runtime data model doesn't carry (see
 * `isListRelationField`). Model bodies are located by `findModelBodyRange`,
 * which counts brace depth (rather than matching up to the first `}`) so a
 * brace inside a quoted attribute value or a `//` comment can't be mistaken
 * for the model's end. Beyond that, this is a line-oriented reading of the
 * schema, not a full parser: for each non-blank, non-comment, non-`@@`
 * attribute line inside a model block, only the first two whitespace-
 * separated tokens (field name, type) are read, so `@relation(...)`,
 * `@map(...)` and other attributes on the same line are ignored along with
 * everything after them.
 *
 * Exported only for `parseListFieldsFromSchema.test.ts`; not part of this
 * package's public API.
 */
export function parseListFieldsFromSchema(
  schemaText: string,
): Map<string, ParsedModelFields> {
  const fieldsByModel = new Map<string, ParsedModelFields>()

  let searchFrom = 0
  let block = findModelBodyRange(schemaText, searchFrom)

  while (block !== null) {
    const { modelName, bodyStart, bodyEnd } = block
    const body = schemaText.slice(bodyStart, bodyEnd)
    const knownFields = new Set<string>()
    const listFields = new Set<string>()

    for (const rawLine of body.split('\n')) {
      // Strip a trailing `//` comment, then trim. A `//` inside a quoted
      // value is rare enough in a field's own type/name tokens (which come
      // before it) that this line-level split, unlike the body-range scan
      // above, doesn't need to be quote-aware.
      const line = rawLine.split('//')[0].trim()

      if (!line || line.startsWith('@@')) {
        continue
      }

      const [fieldName, fieldType] = line.split(/\s+/)
      if (!fieldName || !fieldType) {
        continue
      }

      knownFields.add(fieldName)
      if (fieldType.endsWith('[]')) {
        listFields.add(fieldName)
      }
    }

    fieldsByModel.set(modelName, { knownFields, listFields })
    searchFrom = bodyEnd + 1
    block = findModelBodyRange(schemaText, searchFrom)
  }

  return fieldsByModel
}

/**
 * Builds the schema-derived field map for this client, or `undefined` when
 * the schema source isn't available (an older or non-`prisma-client`
 * generator output), in which case `isListRelationField` falls back to its
 * naming-convention heuristic.
 */
function getListFieldsByModel(
  client: unknown,
): Map<string, ParsedModelFields> | undefined {
  const schemaText = getInlineSchemaText(client)
  return schemaText === undefined
    ? undefined
    : parseListFieldsFromSchema(schemaText)
}

function pascalToCamel(name: string): string {
  return name.length === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Models that Cedar itself owns and that no app row-scopes: the data
 * migration bookkeeping table created by `yarn cedar data-migrate install`.
 * They are never tenant-owned, whichever form `config.models` takes, so
 * framework tooling that runs outside a request keeps working without an
 * `allExcept` entry the app would have to know about.
 */
const FRAMEWORK_MODELS = new Set(['RW_DataMigration'])

/**
 * Resolves `config.models` (camelCase accessor names, either an explicit
 * list or an `allExcept` list) against the runtime data model's PascalCase
 * model names, returning the set of tenant-owned PascalCase model names.
 * Framework-owned models (`FRAMEWORK_MODELS`) are left out of both forms.
 *
 * Throws for any configured name that does not match a runtime model, so a
 * typo in `models` or `allExcept` stops the app at startup instead of
 * silently leaving a model un-scoped.
 */
function resolveTenantModelNames<TClient>(
  modelsConfig: TenancyConfig<TClient>['models'],
  runtimeDataModel: RuntimeDataModel,
): Set<string> {
  const allModelNames = Object.keys(runtimeDataModel.models).filter(
    (name) => !FRAMEWORK_MODELS.has(name),
  )
  const allAccessorNames = new Set(allModelNames.map(pascalToCamel))

  if (Array.isArray(modelsConfig)) {
    const configured = new Set(modelsConfig.map((name) => String(name)))
    const unknown = [...configured].filter(
      (name) => !allAccessorNames.has(name),
    )
    if (unknown.length > 0) {
      throw new TenantScopeError(
        `Unknown model${unknown.length > 1 ? 's' : ''} in tenancy ` +
          `config.models: ${unknown.join(', ')}. Expected one of: ` +
          `${[...allAccessorNames].join(', ')}.`,
      )
    }
    return new Set(
      allModelNames.filter((name) => configured.has(pascalToCamel(name))),
    )
  }

  const excluded = new Set(modelsConfig.allExcept.map((name) => String(name)))
  const unknown = [...excluded].filter((name) => !allAccessorNames.has(name))
  if (unknown.length > 0) {
    throw new TenantScopeError(
      `Unknown model${unknown.length > 1 ? 's' : ''} in tenancy ` +
        `config.models.allExcept: ${unknown.join(', ')}. Expected one of: ` +
        `${[...allAccessorNames].join(', ')}.`,
    )
  }
  return new Set(
    allModelNames.filter((name) => !excluded.has(pascalToCamel(name))),
  )
}

/**
 * Shared state threaded through every rewriting helper below: the resolved
 * config plus the runtime data model, so none of them need their own copy.
 */
interface RewriteContext {
  tenantField: string
  tenantModels: Set<string>
  runtimeDataModel: RuntimeDataModel
  listFieldsByModel: Map<string, ParsedModelFields> | undefined
  getTenantId: () => string | undefined
}

/**
 * A query on a tenant-owned model with nothing in scope means one of three
 * things, and the way out differs for each, so the message says which one
 * this is rather than listing all three every time. What separates them is
 * how much request state there is: no request context at all, a request with
 * nobody signed in, or a signed-in user whose request named no organization.
 */
function tenantScopeError(model: string): TenantScopeError {
  const inRequest = getAsyncStoreInstance().getStore() !== undefined

  if (!inRequest) {
    return new TenantScopeError(
      `"${model}" is tenant-owned, and this code is running outside a ` +
        'request, so there is no organization in scope. Use ' +
        '`db.$forOrg(organizationId)` when the organization is known (a job ' +
        'or a webhook), or `db.$withoutTenant()` when the code works across ' +
        'organizations on purpose (a seed, a data migration, an admin task).',
    )
  }

  if (!context.currentUser) {
    return new TenantScopeError(
      `"${model}" is tenant-owned, and this request has nobody signed in, ` +
        "so no organization was resolved for it. Read one organization's " +
        'data for an anonymous visitor with `db.$forOrg(organizationId)`, ' +
        'which names the organization explicitly.',
    )
  }

  return new TenantScopeError(
    `"${model}" is tenant-owned, and the signed-in user has no organization ` +
      'in scope for this request. Either the request carried no `cedar-org` ' +
      'header, which queries made outside `OrgScope` and functions not ' +
      'wrapped in `withTenancy` do not, or the user has no membership yet ' +
      'and needs one before they can read tenant-owned data.',
  )
}

function requireTenantId(ctx: RewriteContext, model: string): string {
  const tenantId = ctx.getTenantId()

  if (tenantId === undefined) {
    throw tenantScopeError(model)
  }

  return tenantId
}

// Below, Prisma query-extension args are treated as plain JSON-shaped data
// (`UnknownRecord`) rather than typed against Prisma's generated per-model
// arg types: the whole point of this extension is to handle every model's
// arguments the same way, driven by the runtime data model instead of by
// per-model TypeScript types that don't exist generically.
type UnknownRecord = Record<string, unknown>

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findField(
  runtimeDataModel: RuntimeDataModel,
  modelName: string,
  fieldName: string,
): RuntimeField | undefined {
  return runtimeDataModel.models[modelName]?.fields.find(
    (field) => field.name === fieldName,
  )
}

function isRelationField(
  field: RuntimeField | undefined,
): field is RuntimeField & {
  kind: 'object'
} {
  return field?.kind === 'object'
}

/**
 * The naming-convention fallback used when the schema-driven read (see
 * `isListRelationField`) has no answer for a field: a to-one relation field
 * is usually paired with a scalar foreign-key field on the same model,
 * named `<field>Id`. When no such sibling field exists, the relation is
 * treated as the "many" side — the fail-closed choice, since wrongly
 * assuming "many" only adds a `where` filter Prisma rejects loudly, while
 * wrongly assuming "to-one" would silently skip scoping a list relation.
 * This gets two shapes wrong that a correctly parsed schema handles
 * correctly: a to-one foreign key not named `<field>Id`, and the non-owning
 * side of a one-to-one relation (which has no foreign key at all, on either
 * side, despite being to-one).
 */
function isListByForeignKeyHeuristic(
  ctx: RewriteContext,
  modelName: string,
  field: RuntimeField,
): boolean {
  const foreignKeyFieldName = `${field.name}Id`
  const ownFields = ctx.runtimeDataModel.models[modelName]?.fields ?? []
  const hasOwnForeignKey = ownFields.some(
    (f) => f.kind === 'scalar' && f.name === foreignKeyFieldName,
  )
  return !hasOwnForeignKey
}

/**
 * Whether a relation field is the "many" side. The runtime data model
 * doesn't carry `isList` (see `RuntimeField` above), so this reads it from
 * the inline `.prisma` schema source instead, via `ctx.listFieldsByModel`
 * (built once per client by `parseListFieldsFromSchema`): a field is a list
 * exactly when its declared type ends in `[]`, whatever the field is named
 * and on whichever side of the relation it sits.
 *
 * Two distinct gaps in the schema-driven read fall back to
 * `isListByForeignKeyHeuristic` rather than assuming to-one:
 *
 * - `ctx.listFieldsByModel` is `undefined` when the schema source itself
 *   wasn't available on the client at all (see `getInlineSchemaText`).
 * - The model has a parsed entry, but `field.name` isn't in its
 *   `knownFields`: `parseListFieldsFromSchema` reads a model body
 *   line-by-line and only classifies fields whose line it actually parsed,
 *   so a field present in the runtime data model but missing from
 *   `knownFields` means that read is incomplete for this model — a schema
 *   shape the line parser doesn't yet handle, not evidence the field is
 *   to-one. Trusting an absence here is exactly how the cross-tenant leak
 *   this function's fallback exists to prevent would reappear the next time
 *   the line parser meets a schema shape it doesn't handle, so an unknown
 *   field is treated the same as "no schema available" rather than as
 *   "not a list".
 */
function isListRelationField(
  ctx: RewriteContext,
  modelName: string,
  field: RuntimeField,
): boolean {
  const parsedModel = ctx.listFieldsByModel?.get(modelName)
  if (parsedModel?.knownFields.has(field.name)) {
    return parsedModel.listFields.has(field.name)
  }

  return isListByForeignKeyHeuristic(ctx, modelName, field)
}

/**
 * Applies `fn` to `value`, whether it's a single item, an array of items, or
 * absent. Every nested-write and nested-filter argument Prisma accepts is
 * either one of these shapes (`connect: { id }` vs `connect: [{ id }, ...]`)
 * or absent entirely, so this is the one place that distinction is handled.
 */
function mapRows<T>(
  value: unknown,
  fn: (row: unknown) => T,
): T | T[] | undefined | null {
  if (value === undefined || value === null) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(fn)
  }
  return fn(value)
}

/**
 * Merges a tenant equality filter into a `where` clause without inspecting
 * the existing clause's contents: an existing `where` (however it uses
 * `AND`/`OR`/`NOT` or relation filters) is wrapped, unchanged, alongside the
 * new equality check. With no existing `where`, the equality check is the
 * whole filter.
 */
function mergeWhereWithTenant(
  where: unknown,
  tenantField: string,
  tenantId: string,
): UnknownRecord {
  if (where === undefined || where === null) {
    return { [tenantField]: tenantId }
  }
  return { AND: [where, { [tenantField]: tenantId }] }
}

/**
 * Injects (or validates) the tenant field into a `WhereUniqueInput`-shaped
 * object used to target an existing row: `connect`, `disconnect`, `set`,
 * `delete` and `deleteMany` targets. Non-object values (`true`/`false`,
 * used for optional to-one `disconnect`/`delete`) pass through untouched —
 * there's no row identifier to scope.
 */
function injectWhereRow(
  ctx: RewriteContext,
  model: string,
  where: unknown,
): unknown {
  return mapRows(where, (row) => {
    if (!isPlainObject(row)) {
      return row
    }
    if (!ctx.tenantModels.has(model)) {
      return row
    }
    const tenantId = requireTenantId(ctx, model)
    return { ...row, [ctx.tenantField]: tenantId }
  })
}

/**
 * Injects the tenant field into a create row (or array of rows), rejecting
 * a row that already sets a different value. `shallow` skips recursing into
 * the row's own relation fields, for `createMany`/`createManyAndReturn`
 * rows, which Prisma never allows nested relation writes on.
 */
function injectCreateRow(
  ctx: RewriteContext,
  model: string,
  data: unknown,
  options: { shallow?: boolean } = {},
): unknown {
  return mapRows(data, (row) => injectCreateRowSingle(ctx, model, row, options))
}

function injectCreateRowSingle(
  ctx: RewriteContext,
  model: string,
  row: unknown,
  options: { shallow?: boolean },
): unknown {
  if (!isPlainObject(row)) {
    return row
  }

  const next: UnknownRecord = { ...row }

  if (ctx.tenantModels.has(model)) {
    const tenantId = requireTenantId(ctx, model)
    const existing = next[ctx.tenantField]
    if (existing !== undefined && existing !== tenantId) {
      throw new TenantScopeError(
        `Cannot set "${model}.${ctx.tenantField}" to a different ` +
          'organization than the current tenant.',
      )
    }
    next[ctx.tenantField] = tenantId
  }

  if (!options.shallow) {
    for (const [key, value] of Object.entries(next)) {
      const field = findField(ctx.runtimeDataModel, model, key)
      if (isRelationField(field) && isPlainObject(value)) {
        next[key] = processRelationOperations(ctx, field, value)
      }
    }
  }

  return next
}

/**
 * Validates (and recurses through) an `update`-shaped `data` object: the
 * tenant field, if present, must equal the current tenant id (rejecting an
 * attempt to move a row to another organization), and every relation field
 * present gets the same nested-write treatment as a create.
 */
function validateAndRecurseUpdateData(
  ctx: RewriteContext,
  model: string,
  data: unknown,
): unknown {
  if (!isPlainObject(data)) {
    return data
  }

  const next: UnknownRecord = { ...data }

  if (ctx.tenantModels.has(model) && ctx.tenantField in next) {
    const raw = next[ctx.tenantField]
    // Prisma's scalar update syntax allows either the bare value or
    // `{ set: value }`; both mean "set the field to this value".
    const value = isPlainObject(raw) && 'set' in raw ? raw.set : raw
    const tenantId = requireTenantId(ctx, model)
    if (value !== tenantId) {
      throw new TenantScopeError(
        `Cannot change "${model}.${ctx.tenantField}" to a different ` +
          'organization.',
      )
    }
  }

  for (const [key, value] of Object.entries(next)) {
    const field = findField(ctx.runtimeDataModel, model, key)
    if (isRelationField(field) && isPlainObject(value)) {
      next[key] = processRelationOperations(ctx, field, value)
    }
  }

  return next
}

function processUpdateEntry(
  ctx: RewriteContext,
  model: string,
  entry: unknown,
): unknown {
  if (!isPlainObject(entry)) {
    return entry
  }
  // The to-many nested shape is `{ where, data }`; the to-one shape is the
  // `data` object directly, with no `where` (there's only one related row).
  if ('where' in entry && 'data' in entry) {
    return {
      ...entry,
      where: injectWhereRow(ctx, model, entry.where),
      data: validateAndRecurseUpdateData(ctx, model, entry.data),
    }
  }
  return validateAndRecurseUpdateData(ctx, model, entry)
}

function processUpdateManyEntry(
  ctx: RewriteContext,
  model: string,
  entry: unknown,
): unknown {
  if (!isPlainObject(entry)) {
    return entry
  }
  return {
    ...entry,
    where: injectWhereRow(ctx, model, entry.where),
    data: validateAndRecurseUpdateData(ctx, model, entry.data),
  }
}

function processUpsertEntry(
  ctx: RewriteContext,
  model: string,
  entry: unknown,
): unknown {
  if (!isPlainObject(entry)) {
    return entry
  }
  const next: UnknownRecord = { ...entry }
  if ('where' in next) {
    next.where = injectWhereRow(ctx, model, next.where)
  }
  if ('create' in next) {
    next.create = injectCreateRow(ctx, model, next.create)
  }
  if ('update' in next) {
    next.update = validateAndRecurseUpdateData(ctx, model, next.update)
  }
  return next
}

/**
 * Rewrites the nested-write operations object under a relation field —
 * whichever of `create`/`createMany`/`connect`/`connectOrCreate`/
 * `disconnect`/`set`/`update`/`updateMany`/`upsert`/`delete`/`deleteMany`
 * are present — targeting `field`'s model.
 */
function processRelationOperations(
  ctx: RewriteContext,
  field: RuntimeField,
  opsValue: UnknownRecord,
): UnknownRecord {
  const targetModel = field.type
  const next: UnknownRecord = { ...opsValue }

  if ('create' in next) {
    next.create = injectCreateRow(ctx, targetModel, next.create)
  }
  if ('createMany' in next && isPlainObject(next.createMany)) {
    const createMany = next.createMany
    next.createMany = {
      ...createMany,
      data: injectCreateRow(ctx, targetModel, createMany.data, {
        shallow: true,
      }),
    }
  }
  if ('connect' in next) {
    next.connect = injectWhereRow(ctx, targetModel, next.connect)
  }
  if ('connectOrCreate' in next) {
    next.connectOrCreate = mapRows(next.connectOrCreate, (entry) => {
      if (!isPlainObject(entry)) {
        return entry
      }
      return {
        ...entry,
        where: injectWhereRow(ctx, targetModel, entry.where),
        create: injectCreateRow(ctx, targetModel, entry.create),
      }
    })
  }
  if ('disconnect' in next) {
    next.disconnect = injectWhereRow(ctx, targetModel, next.disconnect)
  }
  if ('set' in next) {
    next.set = injectWhereRow(ctx, targetModel, next.set)
  }
  if ('delete' in next) {
    next.delete = injectWhereRow(ctx, targetModel, next.delete)
  }
  if ('deleteMany' in next) {
    next.deleteMany = injectWhereRow(ctx, targetModel, next.deleteMany)
  }
  if ('update' in next) {
    next.update = mapRows(next.update, (entry) =>
      processUpdateEntry(ctx, targetModel, entry),
    )
  }
  if ('updateMany' in next) {
    next.updateMany = mapRows(next.updateMany, (entry) =>
      processUpdateManyEntry(ctx, targetModel, entry),
    )
  }
  if ('upsert' in next) {
    next.upsert = mapRows(next.upsert, (entry) =>
      processUpsertEntry(ctx, targetModel, entry),
    )
  }

  return next
}

/**
 * Rewrites one relation's `include`/`select` value. Only a list relation to
 * a tenant-owned model gets a `where` merged in — Prisma doesn't accept
 * `where` on a to-one relation's include at all — but every relation's value
 * is still walked for further nested `include`/`select` regardless, since a
 * tenant-owned relation can be reached several hops deep from a global
 * model.
 */
function walkRelationIncludeValue(
  ctx: RewriteContext,
  model: string,
  field: RuntimeField,
  value: unknown,
): unknown {
  const targetModel = field.type
  const shouldScope =
    ctx.tenantModels.has(targetModel) && isListRelationField(ctx, model, field)

  if (value === true) {
    if (!shouldScope) {
      return true
    }
    const tenantId = requireTenantId(ctx, targetModel)
    return { where: { [ctx.tenantField]: tenantId } }
  }

  if (!isPlainObject(value)) {
    // e.g. `false` in a `select`.
    return value
  }

  const next: UnknownRecord = { ...value }

  if (shouldScope) {
    const tenantId = requireTenantId(ctx, targetModel)
    next.where = mergeWhereWithTenant(next.where, ctx.tenantField, tenantId)
  }

  // `where`, `orderBy`, `take`, `skip`, `cursor` and `distinct` narrow which
  // related rows come back; they aren't more relations to walk into, and
  // are left exactly as the caller wrote them.
  if ('include' in next) {
    next.include = walkIncludeOrSelect(ctx, targetModel, next.include)
  }
  if ('select' in next) {
    next.select = walkIncludeOrSelect(ctx, targetModel, next.select)
  }

  return next
}

/**
 * Expands `_count: true` into the `select` form when the model has a
 * tenant-owned list relation. The shorthand counts every to-many relation,
 * and a relation reached from a global model is not otherwise limited to one
 * organization, so leaving it as-is would count another organization's rows.
 * Every relation the shorthand covers is listed, so the counts a caller gets
 * back are the same ones, only scoped.
 */
function expandCountShorthand(ctx: RewriteContext, model: string): unknown {
  const listRelations = (
    ctx.runtimeDataModel.models[model]?.fields ?? []
  ).filter(
    (field) => isRelationField(field) && isListRelationField(ctx, model, field),
  )

  const scopesAnything = listRelations.some((field) =>
    ctx.tenantModels.has(field.type),
  )

  if (!scopesAnything) {
    return true
  }

  const select: UnknownRecord = {}

  for (const field of listRelations) {
    select[field.name] = walkRelationIncludeValue(ctx, model, field, true)
  }

  return { select }
}

function walkCountSelect(
  ctx: RewriteContext,
  model: string,
  value: unknown,
): unknown {
  if (value === true) {
    return expandCountShorthand(ctx, model)
  }

  if (!isPlainObject(value)) {
    return value
  }

  const next: UnknownRecord = { ...value }

  if (isPlainObject(next.select)) {
    const select: UnknownRecord = { ...next.select }
    for (const [key, fieldValue] of Object.entries(select)) {
      const field = findField(ctx.runtimeDataModel, model, key)
      if (isRelationField(field)) {
        select[key] = walkRelationIncludeValue(ctx, model, field, fieldValue)
      }
    }
    next.select = select
  }

  return next
}

/**
 * Walks an `include` or `select` object, scoping any tenant-owned list
 * relation it reaches, at any depth, from any model — including a global
 * one, which is never itself restricted but whose relations are.
 */
function walkIncludeOrSelect(
  ctx: RewriteContext,
  model: string,
  node: unknown,
): unknown {
  if (!isPlainObject(node)) {
    return node
  }

  const next: UnknownRecord = { ...node }

  for (const [key, value] of Object.entries(next)) {
    if (key === '_count') {
      next._count = walkCountSelect(ctx, model, value)
      continue
    }

    const field = findField(ctx.runtimeDataModel, model, key)
    if (!isRelationField(field)) {
      // A scalar field selection, or a key this model doesn't have; leave
      // it untouched rather than guess.
      continue
    }

    next[key] = walkRelationIncludeValue(ctx, model, field, value)
  }

  return next
}

const UNIQUE_WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
])

const FILTER_WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
])

/**
 * Every model operation this extension supports. Operations outside this set
 * (MongoDB's `findRaw`/`aggregateRaw`, and any operation Prisma adds later)
 * are rejected rather than passed through un-scoped, since the extension has
 * no way to know whether they honor the `where` clause it injects.
 */
const SUPPORTED_OPERATIONS = new Set([
  ...UNIQUE_WHERE_OPERATIONS,
  ...FILTER_WHERE_OPERATIONS,
  'create',
  'createMany',
  'createManyAndReturn',
])

/**
 * Rewrites the arguments for one Prisma operation on `model`, per the
 * behavior table: top-level `where`/`data` injection when `model` is
 * tenant-owned, plus nested-write and `include`/`select` scoping that runs
 * regardless, since a global model can reach a tenant-owned relation.
 */
function rewriteOperationArgs(
  ctx: RewriteContext,
  model: string,
  operation: string,
  argsIn: unknown,
): UnknownRecord {
  if (!SUPPORTED_OPERATIONS.has(operation)) {
    throw new TenantScopeError(
      `Operation '${operation}' is not supported on a tenant-scoped client. ` +
        'Use db.$withoutTenant() for operations that intentionally bypass ' +
        'tenant scoping.',
    )
  }

  const args: UnknownRecord = isPlainObject(argsIn) ? { ...argsIn } : {}
  const isTenantOwned = ctx.tenantModels.has(model)

  if (isTenantOwned) {
    if (UNIQUE_WHERE_OPERATIONS.has(operation)) {
      const tenantId = requireTenantId(ctx, model)
      args.where = {
        ...(isPlainObject(args.where) ? args.where : {}),
        [ctx.tenantField]: tenantId,
      }
    } else if (FILTER_WHERE_OPERATIONS.has(operation)) {
      const tenantId = requireTenantId(ctx, model)
      args.where = mergeWhereWithTenant(args.where, ctx.tenantField, tenantId)
    }
  }

  if ('data' in args) {
    if (operation === 'createMany' || operation === 'createManyAndReturn') {
      args.data = injectCreateRow(ctx, model, args.data, { shallow: true })
    } else if (operation === 'create') {
      args.data = injectCreateRow(ctx, model, args.data)
    } else if (
      operation === 'update' ||
      operation === 'updateMany' ||
      operation === 'updateManyAndReturn'
    ) {
      args.data = validateAndRecurseUpdateData(ctx, model, args.data)
    }
  }

  if (operation === 'upsert') {
    if ('create' in args) {
      args.create = injectCreateRow(ctx, model, args.create)
    }
    if ('update' in args) {
      args.update = validateAndRecurseUpdateData(ctx, model, args.update)
    }
  }

  if ('include' in args) {
    args.include = walkIncludeOrSelect(ctx, model, args.include)
  }
  if ('select' in args) {
    args.select = walkIncludeOrSelect(ctx, model, args.select)
  }

  return args
}

const RAW_QUERY_MESSAGE =
  'Raw SQL is not allowed on a tenant-scoped client. Use ' +
  'db.$withoutTenant() for raw queries that intentionally bypass tenant ' +
  'scoping.'

function throwRawQueryBlocked(): never {
  throw new TenantScopeError(RAW_QUERY_MESSAGE)
}

/**
 * Builds a Prisma Client extension that scopes every operation on a
 * tenant-owned model to the tenant id `config.getTenantId()` (or the
 * default reader of `context.currentOrg?.id`) returns, and adds
 * `db.$forOrg(organizationId)` / `db.$withoutTenant()` escape hatches.
 *
 * See `docs/implementation-plans/2026-08-26-multi-tenancy.md` ("Layer 1")
 * for the full behavior table this implements.
 */
export function createTenancyExtension<TClient>(
  config: TenancyConfig<TClient>,
) {
  const tenantField = config.tenantField ?? 'organizationId'
  const getTenantId = config.getTenantId ?? (() => getCurrentOrg()?.id)

  return PrismaExtension.defineExtension((client) => {
    const runtimeDataModel = getRuntimeDataModel(client)
    const tenantModels = resolveTenantModelNames(
      config.models,
      runtimeDataModel,
    )
    // Built once per client and reused by every scoped client `$forOrg`
    // hands back; see `isListRelationField`.
    const listFieldsByModel = getListFieldsByModel(client)

    function buildScopedClient(tenantIdSource: () => string | undefined) {
      const ctx: RewriteContext = {
        tenantField,
        tenantModels,
        runtimeDataModel,
        listFieldsByModel,
        getTenantId: tenantIdSource,
      }

      return client.$extends({
        name: 'cedarjs-tenancy',
        query: {
          $allModels: {
            // Prisma's extension callback args are opaque (`JsArgs`, a
            // union over every model's every operation's args type); this
            // extension's whole job is to handle them generically via the
            // runtime data model, so they're read as `unknown` and rebuilt
            // as plain objects rather than cast to a specific args type.
            async $allOperations({ model, operation, args, query }: any) {
              const rewritten = rewriteOperationArgs(
                ctx,
                model,
                operation,
                args,
              )
              return query(rewritten)
            },
          },
          $queryRaw: throwRawQueryBlocked,
          $queryRawUnsafe: throwRawQueryBlocked,
          $executeRaw: throwRawQueryBlocked,
          $executeRawUnsafe: throwRawQueryBlocked,
        },
        client: {
          $queryRaw: throwRawQueryBlocked,
          $queryRawUnsafe: throwRawQueryBlocked,
          $executeRaw: throwRawQueryBlocked,
          $executeRawUnsafe: throwRawQueryBlocked,
        },
      })
    }

    const scopedClient = buildScopedClient(getTenantId)

    return scopedClient.$extends({
      client: {
        /**
         * A client scoped to `organizationId` regardless of request
         * context — for background jobs, webhooks, and other code that
         * knows the tenant but doesn't run inside a request.
         */
        $forOrg(organizationId: string) {
          // The contract is that `$forOrg`/`$withoutTenant` return the same
          // client API as the base, un-extended client: returning `TClient`
          // here (instead of the extension's own derived type) keeps the
          // type Prisma computes for `$extends` from growing with every
          // helper.
          return buildScopedClient(() => organizationId) as unknown as TClient
        },
        /**
         * An unscoped client for code that intentionally reads or writes
         * across organizations: seeds, data migrations, admin tooling.
         * Nothing here is scoped, and raw SQL is allowed.
         */
        $withoutTenant() {
          return client as unknown as TClient
        },
      },
    })
  })
}
