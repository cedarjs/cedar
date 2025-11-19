// This file should only be asynchronously imported by the CLI (typically by
// being statically imported by a *Handler.js file that is in turn
// asynchronously imported by the CLI.)
//
// Importing this file has side effects that can't be run until after we've set
// CWD, plus importing this file statically also makes the CLI startup time
// much slower

import { paramCase } from 'change-case'
import pascalcase from 'pascalcase'

import { pluralize, isPlural, isSingular } from '../../lib/rwPluralize.js'

/**
 * Creates a route path, either returning the existing path if passed, or
 * creating one based on the name. If the passed path is just a route parameter
 * a new path based on the name is created, with the parameter appended to it
 */
export const pathName = (path, name) => {
  let routePath = path

  if (path && path.startsWith('{') && path.endsWith('}')) {
    routePath = `/${paramCase(name)}/${path}`
  }

  if (!routePath) {
    routePath = `/${paramCase(name)}`
  }

  return routePath
}

/** @type {(name: string, generatorName: string) => string } **/
export function removeGeneratorName(name, generatorName) {
  // page -> Page
  const pascalComponentName = pascalcase(generatorName)

  // Replace 'Page' at the end of `name` with ''
  const coercedName = name.replace(new RegExp(pascalComponentName + '$'), '')

  return coercedName
}

export const validateName = (name) => {
  if (name.match(/^\W/)) {
    throw new Error(
      'The <name> argument must start with a letter, number or underscore.',
    )
  }
}

// Returns all relations to other models
export const relationsForModel = (model) => {
  return model.fields
    .filter((f) => f.relationName)
    .map((field) => {
      return field.name
    })
}

// Returns only relations that are of datatype Int
export const intForeignKeysForModel = (model) => {
  return model.fields
    .filter((f) => f.name.match(/Id$/) && f.type === 'Int')
    .map((f) => f.name)
}

/**
 * Adds "List" to the end of words we can't pluralize
 */
export const forcePluralizeWord = (word) => {
  // If word is both plural and singular (like equipment), then append "List"
  if (isPlural(word) && isSingular(word)) {
    return pascalcase(`${word}_list`)
  }

  return pluralize(word)
}

/** @type {(paramType: 'Int' | 'Float' | 'Boolean' | 'String') => string } **/
export const mapRouteParamTypeToTsType = (paramType) => {
  const routeParamToTsType = {
    Int: 'number',
    Float: 'number',
    Boolean: 'boolean',
    String: 'string',
  }
  return routeParamToTsType[paramType] || 'unknown'
}

/** @type {(scalarType: 'String' | 'Boolean' | 'Int' | 'BigInt' | 'Float' | 'Decimal' | 'DateTime' | 'Bytes' ) => string } **/
export const mapPrismaScalarToPagePropTsType = (scalarType) => {
  const prismaScalarToTsType = {
    String: 'string',
    Boolean: 'boolean',
    Int: 'number',
    BigInt: 'number',
    Float: 'number',
    Decimal: 'number',
    DateTime: 'string',
    Bytes: 'Uint8Array',
  }
  return prismaScalarToTsType[scalarType] || 'unknown'
}
