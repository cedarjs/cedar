import fs from 'node:fs'
import path from 'node:path'

import type * as DMMF from '@prisma/dmmf'
import type * as PrismaInternals from '@prisma/internals'

import { getConfig, getPaths, getPrismaSchemas } from '@cedarjs/project-config'
import { pluralize } from '@cedarjs/utils/cedarPluralize'

// These are Cedar/Redwood internal migration models that should never be
// exposed
const INTERNAL_MODEL_NAMES = new Set([
  'RW_DataMigration',
  'Cedar_DataMigration',
])

// Substrings that indicate a field likely contains sensitive data.
// Fields whose lowercased name contains any of these strings are auto-hidden
// unless the field has an explicit @gqlorm show directive.
const SENSITIVE_PATTERNS = [
  'password',
  'secret',
  'token',
  'hash',
  'salt',
  'apikey',
  'secretkey',
  'encryptionkey',
  'privatekey',
]

// ModelSchema type (same as @cedarjs/gqlorm's ModelSchema, re-declared here to
// avoid a cross-package dependency)
type ModelSchema = Record<string, string[]>

interface FrontendFieldInfo {
  name: string
  tsType: string
}

interface FrontendModelInfo {
  modelName: string
  camelName: string
  fields: FrontendFieldInfo[]
}

// ---------------------------------------------------------------------------
// Backend SDL generation types
// ---------------------------------------------------------------------------

export interface BackendFieldInfo {
  name: string
  graphqlType: string // e.g. "Int", "String", "DateTime", "Boolean"
  isRequired: boolean
  isId: boolean
}

export interface BackendModelInfo {
  modelName: string // PascalCase, e.g. "Todo"
  camelName: string // camelCase, e.g. "todo"
  pluralName: string // plural camelCase, e.g. "todos"
  fields: BackendFieldInfo[]
  idField: BackendFieldInfo | undefined
}

export interface GqlormBackendConfig {
  membershipModel: string // PascalCase, e.g., "Membership"
  membershipModelCamel: string // camelCase, e.g., "membership"
  membershipUserField: string // e.g., "userId"
  membershipOrganizationField: string // e.g., "organizationId"
  membershipModelExists: boolean // whether the model exists in the project DMMF
}

const DEFAULT_GQLORM_BACKEND_CONFIG: GqlormBackendConfig = {
  membershipModel: 'Membership',
  membershipModelCamel: 'membership',
  membershipUserField: 'userId',
  membershipOrganizationField: 'organizationId',
  membershipModelExists: false,
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a model or field documentation comment contains a specific
 * @gqlorm directive. The directive must appear at the start of a line (after
 * optional whitespace), which prevents false positives from narrative text.
 */
function hasDirective(
  doc: string | undefined,
  directive: 'hide' | 'show',
): boolean {
  if (!doc) {
    return false
  }
  return doc
    .split('\n')
    .some((line) => line.trimStart().startsWith(`@gqlorm ${directive}`))
}

function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
}

function emitSensitivityWarning(modelName: string, fieldName: string): void {
  console.warn(
    `[gqlorm] ${modelName}.${fieldName} was automatically hidden because its` +
      ` name appears sensitive. Add a directive to suppress this warning:\n\n` +
      `  /// @gqlorm hide – to confirm it should stay hidden\n` +
      `  /// @gqlorm show – to explicitly expose it\n`,
  )
}

// ---------------------------------------------------------------------------
// DMMF type → GraphQL SDL type mapping
// ---------------------------------------------------------------------------

const DMMF_TYPE_TO_GRAPHQL: Record<string, string> = {
  String: 'String',
  Int: 'Int',
  Float: 'Float',
  BigInt: 'BigInt',
  Boolean: 'Boolean',
  DateTime: 'DateTime',
  Json: 'JSON',
  Decimal: 'String',
  Bytes: 'String',
}

/**
 * Map a DMMF field type to its GraphQL SDL equivalent.
 *
 * Enum fields (kind === 'enum') are mapped to String. Unknown scalar types
 * fall back to String.
 */
export function mapDmmfTypeToGraphql(type: string, kind: string): string {
  if (kind === 'enum') {
    return 'String'
  }

  return DMMF_TYPE_TO_GRAPHQL[type] ?? 'String'
}

/**
 * Map a DMMF field type to its TypeScript equivalent for resolver arg typing.
 * Used to produce the correct `{ id }: { id: <type> }` annotation in
 * generated resolver functions.
 */
function graphqlTypeToTsType(graphqlType: string): string {
  switch (graphqlType) {
    case 'Int':
    case 'Float':
    case 'BigInt':
      return 'number'
    case 'Boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Map a GraphQL SDL type to its TypeScript interface type for the GqlormDb
 * interface emitted in backend.ts.
 *
 * DateTime maps to Date (the type Prisma returns). All other non-numeric,
 * non-boolean types fall back to string.
 */
function graphqlTypeToTsInterfaceType(
  graphqlType: string,
  isRequired: boolean,
): string {
  let tsType: string
  switch (graphqlType) {
    case 'Int':
    case 'Float':
    case 'BigInt':
      tsType = 'number'
      break
    case 'Boolean':
      tsType = 'boolean'
      break
    case 'DateTime':
      tsType = 'Date'
      break
    default:
      tsType = 'string'
  }
  return isRequired ? tsType : `${tsType} | null`
}

// ---------------------------------------------------------------------------
// Frontend ModelSchema / type generation helpers
// ---------------------------------------------------------------------------

function dmmfTypeToFrontendTsType(
  type: string,
  kind: string,
  isRequired: boolean,
): string {
  let tsType: string

  if (kind === 'enum') {
    tsType = 'string'
  } else {
    switch (type) {
      case 'String':
        tsType = 'string'
        break
      case 'Int':
      case 'Float':
        tsType = 'number'
        break
      case 'BigInt':
        tsType = 'bigint'
        break
      case 'Boolean':
        tsType = 'boolean'
        break
      case 'DateTime':
        tsType = 'string'
        break
      case 'Json':
        tsType = 'unknown'
        break
      case 'Bytes':
      case 'Decimal':
        tsType = 'string'
        break
      default:
        tsType = 'unknown'
    }
  }

  if (isRequired) {
    return tsType
  }

  return `${tsType} | null`
}

export function buildFrontendModelInfo(
  dmmf: DMMF.Document,
): FrontendModelInfo[] {
  const models: FrontendModelInfo[] = []

  for (const model of dmmf.datamodel.models) {
    if (INTERNAL_MODEL_NAMES.has(model.name)) {
      continue
    }

    if (hasDirective(model.documentation, 'hide')) {
      continue
    }

    const fields: FrontendFieldInfo[] = []

    for (const field of model.fields) {
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        continue
      }

      if (hasDirective(field.documentation, 'hide')) {
        continue
      }

      const isShown = hasDirective(field.documentation, 'show')

      if (!isShown && isSensitiveField(field.name)) {
        continue
      }

      fields.push({
        name: field.name,
        tsType: dmmfTypeToFrontendTsType(
          field.type,
          field.kind,
          field.isRequired,
        ),
      })
    }

    if (fields.length > 0) {
      models.push({
        modelName: model.name,
        camelName: model.name.charAt(0).toLowerCase() + model.name.slice(1),
        fields,
      })
    }
  }

  return models
}

export function generateWebGqlormModelsContent(
  models: FrontendModelInfo[],
): string {
  if (models.length === 0) {
    return [
      '// Auto-generated by Cedar — do not edit',
      '// Regenerated on every codegen run. Source: api/db/schema.prisma',
      '',
      "declare module '@cedarjs/gqlorm/types/orm' {",
      '  interface GqlormTypeMap {}',
      '}',
      '',
    ].join('\n')
  }

  const lines: string[] = [
    '// Auto-generated by Cedar — do not edit',
    '// Regenerated on every codegen run. Source: api/db/schema.prisma',
    '',
    'declare namespace GqlormScalar {',
  ]

  for (const model of models) {
    lines.push(`  interface ${model.modelName} {`)
    for (const field of model.fields) {
      lines.push(`    ${field.name}: ${field.tsType}`)
    }
    lines.push('  }')
    lines.push('')
  }

  lines.push('}')
  lines.push('')
  lines.push("declare module '@cedarjs/gqlorm/types/orm' {")
  lines.push('  interface GqlormTypeMap {')
  lines.push('    models: {')
  for (const model of models) {
    lines.push(`      ${model.camelName}: GqlormScalar.${model.modelName}`)
  }
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Build a ModelSchema from a Prisma DMMF document.
 *
 * This is a pure function with no I/O — it can be called directly in tests
 * with a mock DMMF object.
 */
export function buildModelSchema(dmmf: DMMF.Document): ModelSchema {
  const schema: ModelSchema = {}

  for (const model of dmmf.datamodel.models) {
    if (INTERNAL_MODEL_NAMES.has(model.name)) {
      continue
    }

    if (hasDirective(model.documentation, 'hide')) {
      continue
    }

    const visibleFields: string[] = []

    for (const field of model.fields) {
      // Only include scalar and enum fields; relation (object) and unsupported
      // fields are excluded unconditionally.
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        continue
      }

      // Rule 1: explicit @gqlorm hide → exclude, no warning
      if (hasDirective(field.documentation, 'hide')) {
        continue
      }

      // Rule 2: explicit @gqlorm show → include, no warning
      if (hasDirective(field.documentation, 'show')) {
        visibleFields.push(field.name)
        continue
      }

      // Rule 3: sensitivity heuristic → exclude with warning
      if (isSensitiveField(field.name)) {
        emitSensitivityWarning(model.name, field.name)
        continue
      }

      // Rule 4: include by default
      visibleFields.push(field.name)
    }

    if (visibleFields.length > 0) {
      const camelCaseName =
        model.name.charAt(0).toLowerCase() + model.name.slice(1)
      schema[camelCaseName] = visibleFields
    }
  }

  return schema
}

// ---------------------------------------------------------------------------
// Backend model info builder
// ---------------------------------------------------------------------------

/**
 * Build enriched model information from the DMMF, applying the same visibility
 * rules as `buildModelSchema()` but also collecting type, nullability, and
 * @id flag per field.
 *
 * **Note:** This function silently excludes sensitive fields without emitting
 * warnings. It is designed to run after `buildModelSchema()` (which emits the
 * warnings). In `generateGqlormArtifacts()` the call order is guaranteed, but
 * callers using this function standalone should be aware that no warnings will
 * be printed for auto-hidden sensitive fields.
 *
 * This is a pure function — safe for testing.
 */
export function buildBackendModelInfo(dmmf: DMMF.Document): BackendModelInfo[] {
  const models: BackendModelInfo[] = []

  for (const model of dmmf.datamodel.models) {
    if (INTERNAL_MODEL_NAMES.has(model.name)) {
      continue
    }

    if (hasDirective(model.documentation, 'hide')) {
      continue
    }

    const fields: BackendFieldInfo[] = []

    for (const field of model.fields) {
      // Only include scalar and enum fields
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        continue
      }

      // Rule 1: explicit @gqlorm hide → exclude, no warning
      if (hasDirective(field.documentation, 'hide')) {
        continue
      }

      // Rule 2: explicit @gqlorm show → include, no warning
      const isShown = hasDirective(field.documentation, 'show')

      // Rule 3: sensitivity heuristic → exclude with warning
      if (!isShown && isSensitiveField(field.name)) {
        // Warning already emitted by buildModelSchema which runs first
        continue
      }

      // Rule 4: include by default (or Rule 2)
      fields.push({
        name: field.name,
        graphqlType: mapDmmfTypeToGraphql(field.type, field.kind),
        isRequired: field.isRequired,
        isId: field.isId,
      })
    }

    if (fields.length > 0) {
      const camelName = model.name.charAt(0).toLowerCase() + model.name.slice(1)

      const pluralName = pluralize(camelName)

      models.push({
        modelName: model.name,
        camelName,
        pluralName,
        fields,
        idField: fields.find((f) => f.isId),
      })
    }
  }

  return models
}

// ---------------------------------------------------------------------------
// Existing SDL type detection
// ---------------------------------------------------------------------------

/**
 * Regex that matches `type <PascalCaseName> {` in GraphQL SDL content embedded
 * inside gql template literals. Captures the type name.
 */
const TYPE_DEF_REGEX = /\btype\s+([A-Z]\w*)\s*\{/g

/**
 * Names that are structural in GraphQL and should not be treated as
 * user-defined model types.
 */
const STRUCTURAL_TYPE_NAMES = new Set(['Query', 'Mutation', 'Subscription'])

/**
 * Scan all SDL files in the given directory and return the set of GraphQL type
 * names that are already defined by user-authored SDLs.
 *
 * This prevents gqlorm from generating duplicate type definitions that would
 * cause merge conflicts in `makeMergedSchema`.
 */
export function getExistingSdlTypeNames(graphqlDir: string): Set<string> {
  const typeNames = new Set<string>()

  if (!fs.existsSync(graphqlDir)) {
    return typeNames
  }

  // TODO(gqlorm): Is this still needed? We don't genreate __gqlorm__.sdl.ts
  // anymore, do we?
  const sdlFiles = fs.readdirSync(graphqlDir).filter((file) => {
    // Match *.sdl.ts and *.sdl.js but NOT the generated __gqlorm__.sdl.ts
    return /\.sdl\.(ts|js)$/.test(file) && !file.startsWith('__gqlorm__')
  })

  for (const file of sdlFiles) {
    const content = fs.readFileSync(path.join(graphqlDir, file), 'utf-8')
    let match: RegExpExecArray | null

    // Reset lastIndex before each file
    TYPE_DEF_REGEX.lastIndex = 0
    while ((match = TYPE_DEF_REGEX.exec(content)) !== null) {
      const name = match[1]
      if (!STRUCTURAL_TYPE_NAMES.has(name)) {
        typeNames.add(name)
      }
    }
  }

  return typeNames
}

/**
 * Generate the full TypeScript source for `.cedar/gqlorm/backend.ts`.
 *
 * The generated file exports:
 * - `schema`: a gql DocumentNode with type defs and Query fields
 * - `createGqlormResolvers(db: GqlormDb)`: a factory function that takes a
 *   Prisma client-like object and returns a resolvers object
 *
 * The file does NOT import `db` directly. Instead, the Babel inject plugin
 * imports `db` from `src/lib/db` in `graphql.ts` (where that alias resolves
 * correctly) and passes it to `createGqlormResolvers`.
 *
 * The generated `GqlormDb` interface is scoped to exactly the visible models
 * and fields — no hidden/sensitive fields, no @gqlorm hide models, no
 * dependency on the generated Prisma client path or @prisma/client.
 */
export function generateGqlormBackendContent(
  models: BackendModelInfo[],
  config: GqlormBackendConfig = DEFAULT_GQLORM_BACKEND_CONFIG,
): string {
  if (models.length === 0) {
    return ''
  }

  // Only non-membership models count: the Membership model itself is exempt
  // from org-scoping (it IS the source of org membership data).
  const anyModelNeedsOrgScoping =
    config.membershipModelExists &&
    models.some(
      (m) =>
        m.camelName !== config.membershipModelCamel &&
        m.fields.some((f) => f.name === config.membershipOrganizationField),
    )

  // True when at least one model will emit auth guards — used to decide
  // whether AuthenticationError / ForbiddenError need to be imported.
  const anyModelNeedsAuth = models.some((m) => {
    const hasUserField = m.fields.some(
      (f) => f.name === config.membershipUserField,
    )
    const hasOrgField = m.fields.some(
      (f) => f.name === config.membershipOrganizationField,
    )
    const isMembership = m.camelName === config.membershipModelCamel
    return (
      hasUserField ||
      (hasOrgField && config.membershipModelExists && !isMembership)
    )
  })

  const lines: string[] = [
    '// This file is auto-generated by Cedar gqlorm codegen.',
    '// Do not edit — it will be overwritten on every codegen run.',
    '// To hide a model from gqlorm, add /// @gqlorm hide in schema.prisma.',
    '',
    "import gql from 'graphql-tag'",
    ...(anyModelNeedsAuth
      ? [
          "import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'",
        ]
      : []),
    '',
    '// Minimal context type used in auth checks',
    'interface GqlormContext {',
    '  currentUser: Record<string, unknown> | null | undefined',
    '}',
    '',
    '// Generated minimal interface — only visible models and fields, only the',
    '// operations used by this file. No @gqlorm hide models, no sensitive fields.',
    '// Scoped to avoid any dependency on the generated Prisma client path or',
    '// @prisma/client (which is an empty shim in Prisma v7).',
    'interface GqlormDb {',
  ]

  // --- GqlormDb interface ---
  for (const model of models) {
    const selectType = model.fields.map((f) => `${f.name}: true`).join('; ')

    lines.push(`  ${model.camelName}: {`)

    // findMany
    lines.push('    findMany(args: {')
    lines.push('      where?: Record<string, unknown>')
    lines.push(`      select: Partial<{ ${selectType} }>`)
    lines.push('    }): Promise<')
    lines.push('      Array<{')
    for (const field of model.fields) {
      const tsType = graphqlTypeToTsInterfaceType(
        field.graphqlType,
        field.isRequired,
      )
      lines.push(`        ${field.name}: ${tsType}`)
    }
    lines.push('      }>')
    lines.push('    >')

    // findUnique (only if there's an id field)
    if (model.idField) {
      const idTsType = graphqlTypeToTsType(model.idField.graphqlType)
      lines.push('    findUnique(args: {')
      lines.push(`      where: { ${model.idField.name}: ${idTsType} }`)
      lines.push(`      select: { ${selectType} }`)
      lines.push('    }): Promise<{')
      for (const field of model.fields) {
        const tsType = graphqlTypeToTsInterfaceType(
          field.graphqlType,
          field.isRequired,
        )
        lines.push(`      ${field.name}: ${tsType}`)
      }
      lines.push('    } | null>')
    }

    // findFirst — needed for org-scoping when this is the membership model
    if (
      anyModelNeedsOrgScoping &&
      model.camelName === config.membershipModelCamel
    ) {
      lines.push('    findFirst(args: {')
      lines.push('      where: Record<string, unknown>')
      lines.push('    }): Promise<Record<string, unknown> | null>')
    }

    lines.push('  }')
  }

  // Membership model entry in GqlormDb if any model needs org scoping
  // and the model wasn't already emitted by the models loop above
  const membershipAlreadyInModels = models.some(
    (m) => m.camelName === config.membershipModelCamel,
  )
  if (anyModelNeedsOrgScoping && !membershipAlreadyInModels) {
    lines.push(`  ${config.membershipModelCamel}: {`)
    lines.push('    findMany(args: {')
    lines.push('      where: Record<string, unknown>')
    lines.push(`      select: { ${config.membershipOrganizationField}: true }`)
    lines.push('    }): Promise<')
    lines.push(
      `      Array<{ ${config.membershipOrganizationField}: unknown }>`,
    )
    lines.push('    >')
    lines.push('    findFirst(args: {')
    lines.push('      where: Record<string, unknown>')
    lines.push('    }): Promise<Record<string, unknown> | null>')
    lines.push('  }')
  }

  lines.push('}')
  lines.push('')

  // --- schema ---
  lines.push('export const schema = gql`')

  for (const model of models) {
    lines.push(`  type ${model.modelName} {`)
    for (const field of model.fields) {
      const nullMark = field.isRequired ? '!' : ''
      lines.push(`    ${field.name}: ${field.graphqlType}${nullMark}`)
    }
    lines.push('  }')
    lines.push('')
  }

  lines.push('  type Query {')
  for (const model of models) {
    const hasUserField = model.fields.some(
      (f) => f.name === config.membershipUserField,
    )
    const hasOrgField = model.fields.some(
      (f) => f.name === config.membershipOrganizationField,
    )
    const isMembershipModel = model.camelName === config.membershipModelCamel
    const needsAuth =
      hasUserField ||
      (hasOrgField && config.membershipModelExists && !isMembershipModel)
    const authDirective = needsAuth ? '@requireAuth' : '@skipAuth'
    lines.push(
      `    ${model.pluralName}: [${model.modelName}!]! ${authDirective}`,
    )
    if (model.idField) {
      const idNullMark = model.idField.isRequired ? '!' : ''
      lines.push(
        `    ${model.camelName}(${model.idField.name}: ${model.idField.graphqlType}${idNullMark}): ${model.modelName} ${authDirective}`,
      )
    }
  }
  lines.push('  }')
  lines.push('`')
  lines.push('')

  // --- factory function ---
  lines.push(
    '// db is passed in from graphql.ts by the Babel inject plugin, which imports it',
  )
  lines.push(
    "// from 'src/lib/db' in a context where that alias resolves correctly.",
  )
  lines.push('export function createGqlormResolvers(db: GqlormDb) {')
  lines.push('  return {')
  lines.push('    Query: {')

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    const selectObj = model.fields.map((f) => `${f.name}: true`).join(', ')

    const hasUserField = model.fields.some(
      (f) => f.name === config.membershipUserField,
    )
    const hasOrgField = model.fields.some(
      (f) => f.name === config.membershipOrganizationField,
    )
    // The Membership model is exempt from org-scoping: it is the authoritative
    // source of org membership data, so scoping it by org would be a
    // self-referential N+1 (querying memberships to scope the membership query).
    const isMembershipModel = model.camelName === config.membershipModelCamel
    const useOrgScoping =
      hasOrgField && config.membershipModelExists && !isMembershipModel

    // findMany resolver
    lines.push(
      `      ${model.pluralName}: async (_root: unknown, _args: unknown, ${hasUserField || useOrgScoping ? 'context' : '_context'}: GqlormContext) => {`,
    )

    if (hasUserField || useOrgScoping) {
      lines.push('        if (!context.currentUser) {')
      lines.push(
        `          throw new AuthenticationError("You don't have permission to do that.")`,
      )
      lines.push('        }')
      lines.push("        const currentUserId = context.currentUser['id']")
      lines.push(
        '        if (currentUserId === undefined || currentUserId === null) {',
      )
      lines.push(
        `          throw new AuthenticationError("Could not determine the current user's ID.")`,
      )
      lines.push('        }')
      lines.push('        const where: Record<string, unknown> = {}')

      if (hasUserField) {
        lines.push('        // Scope to the current user')
        lines.push(
          `        where['${config.membershipUserField}'] = currentUserId`,
        )
      }

      if (useOrgScoping) {
        lines.push("        // Scope to the current user's organizations")
        lines.push(
          `        const memberships = await db.${config.membershipModelCamel}.findMany({`,
        )
        lines.push(
          `          where: { ${config.membershipUserField}: currentUserId },`,
        )
        lines.push(
          `          select: { ${config.membershipOrganizationField}: true },`,
        )
        lines.push('        })')
        lines.push(
          `        const organizationIds = memberships.map((m) => m.${config.membershipOrganizationField})`,
        )
        lines.push(
          `        where['${config.membershipOrganizationField}'] = { in: organizationIds }`,
        )
      }

      lines.push(`        return db.${model.camelName}.findMany({`)
      lines.push('          where,')
      lines.push(`          select: { ${selectObj} },`)
      lines.push('        })')
    } else {
      lines.push(`        return db.${model.camelName}.findMany({`)
      lines.push(`          select: { ${selectObj} },`)
      lines.push('        })')
    }

    lines.push('      },')

    // findUnique resolver
    if (model.idField) {
      const idFieldName = model.idField.name
      const tsType = graphqlTypeToTsType(model.idField.graphqlType)
      lines.push(
        `      ${model.camelName}: async (_root: unknown, { ${idFieldName} }: { ${idFieldName}: ${tsType} }, ${hasUserField || useOrgScoping ? 'context' : '_context'}: GqlormContext) => {`,
      )

      if (hasUserField || useOrgScoping) {
        lines.push('        if (!context.currentUser) {')
        lines.push(
          `          throw new AuthenticationError("You don't have permission to do that.")`,
        )
        lines.push('        }')
        lines.push("        const currentUserId = context.currentUser['id']")
        lines.push(
          '        if (currentUserId === undefined || currentUserId === null) {',
        )
        lines.push(
          `          throw new AuthenticationError("Could not determine the current user's ID.")`,
        )
        lines.push('        }')
      }

      lines.push('')
      lines.push(
        `        const record = await db.${model.camelName}.findUnique({`,
      )
      lines.push(`          where: { ${idFieldName} },`)
      lines.push(`          select: { ${selectObj} },`)
      lines.push('        })')
      lines.push('')
      lines.push('        if (!record) {')
      lines.push('          return null')
      lines.push('        }')

      if (hasUserField) {
        lines.push('')
        lines.push('        // Verify the current user owns this record')
        lines.push(
          `        if (record.${config.membershipUserField} !== currentUserId) {`,
        )
        lines.push(
          `          throw new ForbiddenError('Not authorized to access this resource')`,
        )
        lines.push('        }')
      }

      if (useOrgScoping) {
        lines.push('')
        lines.push(
          "        // Verify the current user belongs to the record's organization",
        )
        lines.push(
          `        const membership = await db.${config.membershipModelCamel}.findFirst({`,
        )
        lines.push('          where: {')
        lines.push(`            ${config.membershipUserField}: currentUserId,`)
        lines.push(
          `            ${config.membershipOrganizationField}: record.${config.membershipOrganizationField},`,
        )
        lines.push('          },')
        lines.push('        })')
        lines.push('        if (!membership) {')
        lines.push(
          `          throw new ForbiddenError('Not authorized to access this resource')`,
        )
        lines.push('        }')
      }

      lines.push('')
      lines.push('        return record')
      lines.push('      },')
    }

    // Blank line between models for readability (but not after the last one)
    if (i < models.length - 1) {
      lines.push('')
    }
  }

  lines.push('    },')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main codegen entry point
// ---------------------------------------------------------------------------

/**
 * Generate gqlorm artifacts from the Prisma schema.
 *
 * Reads the project's Prisma schema via DMMF, applies visibility rules
 * (@gqlorm directives + sensitivity heuristics), and writes:
 *
 * 1. `.cedar/gqlorm-schema.json` — the frontend ModelSchema (field names only)
 * 2. `.cedar/gqlorm/backend.ts` — auto-generated GraphQL types and resolvers
 *    for models that don't already have manually-written SDL files
 *
 * Cedar targets Node.js 24, which strips TypeScript types natively without any
 * flags, so backend.ts can be imported directly at runtime
 *
 * Returns the same `{ files, errors }` shape used by other generators so it
 * can be integrated into `generate.ts` without special handling.
 */
export async function generateGqlormArtifacts(): Promise<{
  files: string[]
  errors: { message: string; error: unknown }[]
}> {
  if (!getConfig().experimental?.gqlorm?.enabled) {
    // Clean up any stale files left over from when gqlorm was previously
    // enabled, so that disabling the flag removes all generated artifacts.
    const generatedBase = getPaths().generated.base
    const staleFiles = [
      path.join(generatedBase, 'gqlorm', 'backend.ts'),
      path.join(generatedBase, 'gqlorm-schema.json'),
      path.join(generatedBase, 'types', 'includes', 'web-gqlorm-models.d.ts'),
    ]
    for (const staleFile of staleFiles) {
      if (fs.existsSync(staleFile)) {
        fs.unlinkSync(staleFile)
      }
    }
    return { files: [], errors: [] }
  }

  const files: string[] = []
  const errors: { message: string; error: unknown }[] = []

  try {
    const { schemas } = await getPrismaSchemas()

    const mod = await import('@prisma/internals')
    // ESM vs CJS interop: in ESM context @prisma/internals resolves
    // everything onto `default`, in CJS it's directly on the module.
    const { getDMMF } = (mod.default || mod) as typeof PrismaInternals
    const dmmf = await getDMMF({ datamodel: schemas })
    const paths = getPaths()

    // -----------------------------------------------------------------------
    // 1. Frontend ModelSchema (.cedar/gqlorm-schema.json)
    // -----------------------------------------------------------------------
    const generatedBase = paths.generated.base
    const modelSchema = buildModelSchema(dmmf)
    const frontendModels = buildFrontendModelInfo(dmmf)

    const schemaOutputPath = path.join(generatedBase, 'gqlorm-schema.json')
    const webTypesOutputPath = path.join(
      generatedBase,
      'types',
      'includes',
      'web-gqlorm-models.d.ts',
    )

    fs.mkdirSync(path.dirname(schemaOutputPath), { recursive: true })
    fs.writeFileSync(schemaOutputPath, JSON.stringify(modelSchema, null, 2))
    files.push(schemaOutputPath)

    fs.mkdirSync(path.dirname(webTypesOutputPath), { recursive: true })
    fs.writeFileSync(
      webTypesOutputPath,
      generateWebGqlormModelsContent(frontendModels),
    )
    files.push(webTypesOutputPath)

    // -----------------------------------------------------------------------
    // 2. Backend (.cedar/gqlorm/backend.ts)
    // -----------------------------------------------------------------------
    const backendOutputDir = path.join(generatedBase, 'gqlorm')
    const backendOutputPath = path.join(backendOutputDir, 'backend.ts')

    const graphqlDir = paths.api.graphql
    const existingTypes = getExistingSdlTypeNames(graphqlDir)
    const allModels = buildBackendModelInfo(dmmf)

    const gqlormConfig = getConfig().experimental.gqlorm
    const membershipModel: string = gqlormConfig.membershipModel ?? 'Membership'
    const membershipModelCamel =
      membershipModel.charAt(0).toLowerCase() + membershipModel.slice(1)
    const membershipUserField: string =
      gqlormConfig.membershipUserField ?? 'userId'
    const membershipOrganizationField: string =
      gqlormConfig.membershipOrganizationField ?? 'organizationId'

    // Check if membership model exists in the DMMF (not just gqlorm-visible models)
    const membershipModelExists = dmmf.datamodel.models.some(
      (m) => m.name === membershipModel,
    )

    const backendConfig: GqlormBackendConfig = {
      membershipModel,
      membershipModelCamel,
      membershipUserField,
      membershipOrganizationField,
      membershipModelExists,
    }

    // Filter out models whose type name already exists in user-authored SDLs
    const gqlormModels = allModels.filter(
      (m) => !existingTypes.has(m.modelName),
    )

    // Warn when org scoping can't be applied because the membership model is missing
    const anyModelHasOrgField = gqlormModels.some((m) =>
      m.fields.some((f) => f.name === membershipOrganizationField),
    )
    if (anyModelHasOrgField && !membershipModelExists) {
      console.warn(
        `[gqlorm] One or more models have a \`${membershipOrganizationField}\` field, ` +
          `but the membership model "${membershipModel}" was not found in the schema. ` +
          `Organization-based access scoping will not be applied for these models. ` +
          `Add a \`${membershipModel}\` model to your schema.prisma or configure ` +
          `\`experimental.gqlorm.membershipModel\` in cedar.toml.`,
      )
    }

    if (gqlormModels.length > 0) {
      const backendContent = generateGqlormBackendContent(
        gqlormModels,
        backendConfig,
      )
      fs.mkdirSync(backendOutputDir, { recursive: true })
      fs.writeFileSync(backendOutputPath, backendContent)
      files.push(backendOutputPath)
    } else {
      // No models to generate — clean up stale file if it exists
      if (fs.existsSync(backendOutputPath)) {
        fs.unlinkSync(backendOutputPath)
      }
    }
  } catch (error) {
    errors.push({
      message: 'Failed to generate gqlorm schema artifacts',
      error,
    })
  }

  return { files, errors }
}
