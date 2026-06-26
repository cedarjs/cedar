import type * as DMMF from '@prisma/dmmf'
import prismaInternals from '@prisma/internals'

import { getPrismaSchemas } from '@cedarjs/project-config'
import { singularize, isPlural } from '@cedarjs/utils/cedarPluralize'

import { ensureUniquePlural } from './pluralHelpers.js'

const { getConfig, getDMMF } = prismaInternals

// Prisma's DMMF.Field is ReadonlyDeep and doesn't include enumValues.
// We attach enumValues after loading the schema, so we use this enriched type.
type EnrichedField = Omit<DMMF.Field, never> & {
  enumValues?: DMMF.DatamodelEnum['values']
}
type EnrichedModel = Omit<DMMF.Model, 'fields'> & {
  readonly fields: readonly EnrichedField[]
}

/**
 * Used to memoize results from `getSchema()` so we don't have to go through
 * the work of opening and parsing the file from scratch each time `getSchema()`
 * is called with the same model name.
 */
const schemaMemo: Record<string, EnrichedModel> = {}

/**
 * Searches for the given model (ignoring case) in `schema.prisma`
 * and returns the name as it is written by the user, or
 * `undefined` if no model could be found
 */
const getExistingModelName = async (
  name: string | undefined,
): Promise<string | undefined> => {
  if (!name) {
    return undefined
  }

  // Support PascalCase, camelCase, kebab-case, UPPER_CASE,
  // and lowercase model names
  const modelName = name.replace(/[_-]/g, '').toLowerCase()
  for (const model of Object.values(schemaMemo)) {
    if (model.name.toLowerCase() === modelName) {
      return model.name
    }
  }

  const schema = (await getSchemaDefinitions()).datamodel
  for (const model of schema.models) {
    if (model.name.toLowerCase() === modelName) {
      return model.name
    }
  }

  return undefined
}

/**
 * Returns the database schema for the given `name` database table parsed from
 * the schema.prisma of the target application. If no `name` is given then the
 * entire schema is returned.
 */
export const getSchema = async (
  name?: string,
): Promise<DMMF.Datamodel | EnrichedModel | undefined> => {
  const schema = (await getSchemaDefinitions()).datamodel

  if (!name) {
    return schema
  }

  const modelName = await getExistingModelName(name)
  if (!modelName) {
    throw new Error(
      `No schema definition found for \`${name}\` in schema.prisma file`,
    )
  }

  if (schemaMemo[modelName]) {
    return schemaMemo[modelName]
  }

  const model = schema.models.find((m) => m.name === modelName)
  if (!model) {
    // TODO: Can this happen, and if yes, should we prefer throwing an error?
    return undefined
  }

  // Look for any fields that are enums and attach the possible enum values
  // so we can put them in generated test files.
  // We create new enriched field objects rather than mutating the readonly Prisma types.
  const enrichedFields: EnrichedField[] = model.fields.map((field) => {
    const fieldEnum = schema.enums.find((e) => field.type === e.name)
    return fieldEnum ? { ...field, enumValues: fieldEnum.values } : { ...field }
  })

  const enrichedModel: EnrichedModel = { ...model, fields: enrichedFields }

  // Memoize based on the model name
  schemaMemo[modelName] = enrichedModel

  return enrichedModel
}

/**
 * Returns the enum defined with the given `name` parsed from the
 * `schema.prisma` of the target application. If no `name` is given
 * then all enum definitions are returned
 */
export const getEnum = async (
  name?: string,
): Promise<DMMF.DatamodelEnum[] | DMMF.DatamodelEnum> => {
  const schema = await getSchemaDefinitions()
  if (!name) {
    return schema.metadata.datamodel.enums
  }

  const model = schema.datamodel.enums.find((e) => e.name === name)
  if (!model) {
    throw new Error(
      `No enum schema definition found for \`${name}\` in schema.prisma file`,
    )
  }

  return model
}

/**
 * Returns the data model defined in `schema.prisma` (models, enums, etc.)
 */
export const getDataModel = async () => {
  const result = await getPrismaSchemas()
  return result.schemas
}

/**
 * Returns the DMMF defined by `prisma` resolving the relevant `schema.prisma` path.
 */
export const getSchemaDefinitions = async (): Promise<DMMF.Document> => {
  return getDMMF({ datamodel: await getDataModel() })
}

/**
 * Returns the config info defined in `schema.prisma` (provider, datasource, etc.)
 */
export const getSchemaConfig = async () => {
  return getConfig({
    datamodel: await getDataModel(),
  })
}

interface VerifyModelNameOptions {
  name: string
  isDestroyer?: boolean
}

export async function verifyModelName(
  options: VerifyModelNameOptions,
): Promise<VerifyModelNameOptions> {
  const modelName =
    (await getExistingModelName(options.name)) ||
    (await getExistingModelName(singularize(options.name)))

  if (modelName === undefined) {
    throw new Error(
      `"${options.name}" model not found, check if it exists in "./api/db/schema.prisma"`,
    )
  }

  await ensureUniquePlural({
    model: modelName,
    isDestroyer: options.isDestroyer,
    forcePrompt: isPlural(modelName),
  })

  return { ...options, name: modelName }
}
