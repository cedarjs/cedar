// This file should only be asynchronously imported by the CLI (typically by
// being statically imported by a *Handler.js file that is in turn
// asynchronously imported by the CLI.)
//
// Importing this file has side effects that can't be run until after we've set
// CWD, plus importing this file statically also makes the CLI startup time
// much slower

import { paramCase } from 'change-case'
import pascalcase from 'pascalcase'

import { pluralize, isPlural, isSingular } from '@cedarjs/utils/cedarPluralize'

interface ModelField {
  name: string
  relationName?: string
  type: string
}

interface Model {
  fields: readonly ModelField[]
}

/**
 * Creates a route path, either returning the existing path if passed, or
 * creating one based on the name. If the passed path is just a route parameter
 * a new path based on the name is created, with the parameter appended to it
 */
export const pathName = (path: string | undefined, name: string) => {
  let routePath = path

  if (path && path.startsWith('{') && path.endsWith('}')) {
    routePath = `/${paramCase(name)}/${path}`
  }

  if (!routePath) {
    routePath = `/${paramCase(name)}`
  }

  return routePath
}

export function removeGeneratorName(
  name: string,
  generatorName: string,
): string {
  // page -> Page
  const pascalComponentName = pascalcase(generatorName)

  // Replace 'Page' at the end of `name` with ''
  const coercedName = name.replace(new RegExp(pascalComponentName + '$'), '')

  return coercedName
}

export const validateName = (name: string) => {
  if (name.match(/^\W/)) {
    throw new Error(
      'The <name> argument must start with a letter, number or underscore.',
    )
  }
}

/**
 * Names of the fields that Cedar's dbAuth setup adds to the user model for
 * authentication. They should never be exposed through the GraphQL API, so
 * the SDL, service and scaffold generators skip them when generating GraphQL
 * types and inputs, forms, cells and test inputs. (Database scenarios keep
 * them, since creating rows requires the ones that are non-optional.)
 */
export const SENSITIVE_FIELDS = [
  'hashedPassword',
  'salt',
  'resetToken',
  'resetTokenExpiresAt',
  'webAuthnChallenge',
]

/**
 * Given all field names of a model, returns the ones the generators should
 * exclude from generated SDL, forms, cells and test inputs (see
 * `SENSITIVE_FIELDS`).
 *
 * `salt` is a generic enough word that it can be totally benign on its own
 * (think `Recipe.salt`), so it's only treated as sensitive when the model has
 * at least one other sensitive field
 */
export const redactedModelFields = (fieldNames: string[]) => {
  const sensitive = fieldNames.filter((name) => SENSITIVE_FIELDS.includes(name))

  if (sensitive.length === 1 && sensitive[0] === 'salt') {
    return []
  }

  return sensitive
}

// Returns all relations to other models
export const relationsForModel = (model: Model | undefined) => {
  return model?.fields
    .filter((f: ModelField) => f.relationName)
    .map((field: ModelField) => {
      return field.name
    })
}

// Returns only relations that are of datatype Int
export const intForeignKeysForModel = (model: Model) => {
  return model.fields
    .filter((f: ModelField) => f.name.match(/Id$/) && f.type === 'Int')
    .map((f: ModelField) => f.name)
}

/**
 * Adds "List" to the end of words we can't pluralize
 */
export const forcePluralizeWord = (word: string) => {
  // If word is both plural and singular (like equipment), then append "List"
  if (isPlural(word) && isSingular(word)) {
    return pascalcase(`${word}_list`)
  }

  return pluralize(word)
}

const routeParamToTsType: Record<string, string> = {
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  String: 'string',
}

export const mapRouteParamTypeToTsType = (
  paramType: keyof typeof routeParamToTsType,
) => {
  return routeParamToTsType[paramType] || 'unknown'
}

const prismaScalarToTsType: Record<string, string> = {
  String: 'string',
  Boolean: 'boolean',
  Int: 'number',
  BigInt: 'number',
  Float: 'number',
  Decimal: 'number',
  DateTime: 'string',
  Bytes: 'Uint8Array',
}

export const mapPrismaScalarToPagePropTsType = (
  scalarType: keyof typeof prismaScalarToTsType,
) => {
  return prismaScalarToTsType[scalarType] || 'unknown'
}
