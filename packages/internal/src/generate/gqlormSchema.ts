import fs from 'node:fs'
import path from 'node:path'

import type * as DMMF from '@prisma/dmmf'
import type * as PrismaInternals from '@prisma/internals'

import { getPaths, getPrismaSchemas } from '@cedarjs/project-config'
import { pluralize } from '@cedarjs/utils/cedarPluralize'

// These are Cedar/Redwood internal migration models that should never be
// exposed
const INTERNAL_MODEL_NAMES = new Set(['RW_DataMigration'])

// Substrings that indicate a field likely contains sensitive data.
// Fields whose lowercased name contains any of these strings are auto-hidden
// unless the field has an explicit @gqlorm show directive.
const SENSITIVE_PATTERNS = ['password', 'secret', 'token', 'hash', 'salt']

// ModelSchema type (same as @cedarjs/gqlorm's ModelSchema, re-declared here to
// avoid a cross-package dependency)
type ModelSchema = Record<string, string[]>

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
// Frontend ModelSchema builder (unchanged logic)
// ---------------------------------------------------------------------------

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
): string {
  if (models.length === 0) {
    return ''
  }

  const lines: string[] = [
    '// This file is auto-generated by Cedar gqlorm codegen.',
    '// Do not edit — it will be overwritten on every codegen run.',
    '// To hide a model from gqlorm, add /// @gqlorm hide in schema.prisma.',
    '',
    "import gql from 'graphql-tag'",
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
    lines.push(`      select: { ${selectType} }`)
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
    lines.push(`    ${model.pluralName}: [${model.modelName}!]! @skipAuth`)
    if (model.idField) {
      const idNullMark = model.idField.isRequired ? '!' : ''
      lines.push(
        `    ${model.camelName}(${model.idField.name}: ${model.idField.graphqlType}${idNullMark}): ${model.modelName} @skipAuth`,
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

    // findMany resolver
    lines.push(`      ${model.pluralName}: () => {`)
    lines.push(`        return db.${model.camelName}.findMany({`)
    lines.push(`          select: { ${selectObj} },`)
    lines.push('        })')
    lines.push('      },')

    // findUnique resolver
    if (model.idField) {
      const idFieldName = model.idField.name
      const tsType = graphqlTypeToTsType(model.idField.graphqlType)
      lines.push(
        `      ${model.camelName}: (_root: unknown, { ${idFieldName} }: { ${idFieldName}: ${tsType} }) => {`,
      )
      lines.push(`        return db.${model.camelName}.findUnique({`)
      lines.push(`          where: { ${idFieldName} },`)
      lines.push(`          select: { ${selectObj} },`)
      lines.push('        })')
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
  const files: string[] = []
  const errors: { message: string; error: unknown }[] = []

  try {
    const { schemas } = await getPrismaSchemas()

    const mod = await import('@prisma/internals')
    // ESM vs CJS interop: in ESM context @prisma/internals resolves
    // everything onto `default`, in CJS it's directly on the module.
    const { getDMMF } = (mod.default || mod) as typeof PrismaInternals
    const dmmf = await getDMMF({ datamodel: schemas })

    // -----------------------------------------------------------------------
    // 1. Frontend ModelSchema (.cedar/gqlorm-schema.json) — unchanged
    // -----------------------------------------------------------------------
    const modelSchema = buildModelSchema(dmmf)

    const schemaOutputPath = path.join(
      getPaths().generated.base,
      'gqlorm-schema.json',
    )

    fs.mkdirSync(path.dirname(schemaOutputPath), { recursive: true })
    fs.writeFileSync(schemaOutputPath, JSON.stringify(modelSchema, null, 2))
    files.push(schemaOutputPath)

    // -----------------------------------------------------------------------
    // 2. Backend (.cedar/gqlorm/backend.ts)
    // -----------------------------------------------------------------------
    const graphqlDir = getPaths().api.graphql
    const existingTypes = getExistingSdlTypeNames(graphqlDir)
    const allModels = buildBackendModelInfo(dmmf)

    // Filter out models whose type name already exists in user-authored SDLs
    const gqlormModels = allModels.filter(
      (m) => !existingTypes.has(m.modelName),
    )

    const backendOutputDir = path.join(getPaths().generated.base, 'gqlorm')
    const backendOutputPath = path.join(backendOutputDir, 'backend.ts')

    if (gqlormModels.length > 0) {
      const backendContent = generateGqlormBackendContent(gqlormModels)
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
