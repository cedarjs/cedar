import fs from 'node:fs'
import path from 'node:path'

import type * as DMMF from '@prisma/dmmf'
import type * as PrismaInternals from '@prisma/internals'

import { getPaths, getPrismaSchemas } from '@cedarjs/project-config'

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

/**
 * Generate gqlorm artifacts from the Prisma schema.
 *
 * Reads the project's Prisma schema via DMMF, applies visibility rules
 * (@gqlorm directives + sensitivity heuristics), and writes the resulting
 * ModelSchema to `.cedar/gqlorm-schema.json`.
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
    const modelSchema = buildModelSchema(dmmf)

    const outputPath = path.join(
      getPaths().generated.base,
      'gqlorm-schema.json',
    )

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(modelSchema, null, 2))

    files.push(outputPath)
  } catch (error) {
    errors.push({
      message: 'Failed to generate gqlorm schema artifacts',
      error,
    })
  }

  return { files, errors }
}
