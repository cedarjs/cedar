import path from 'node:path'

import camelcase from 'camelcase'

import { pluralize, singularize } from '@cedarjs/utils/cedarPluralize'

import { transformTSToJS } from '../../../lib/index.js'
import { getSchema, verifyModelName } from '../../../lib/schemaHelpers.js'
import { redactedModelFields, relationsForModel } from '../helpers.js'
import { createHandler, templateForFile } from '../yargsHandlerHelpers.js'

interface ServiceModel {
  name: string
  documentation?: string
  fields: PrismaField[]
  primaryKey?: { fields: string[]; name?: string | null } | null
}

/**
 * Describes a model's compound `@@id([...])` primary key, as opposed to a
 * single field with `@id`. `whereArg` is the Prisma Client `where` key for
 * looking a record up by its compound id: the user-supplied `@@id(name:
 * "...")`, or Prisma's default of joining the field names with `_`.
 */
export interface CompositeIdName {
  fields: string[]
  whereArg: string
}

function isServiceModel(schema: unknown): schema is ServiceModel {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'fields' in schema &&
    'name' in schema
  )
}

const DEFAULT_SCENARIO_NAMES = ['one', 'two']

export interface PrismaField {
  name: string
  type: string
  kind: string
  isList: boolean
  isRequired: boolean
  isId: boolean
  isUnique?: boolean
  hasDefaultValue?: boolean
  relationName?: string
  relationFromFields?: string[]
  enumValues?: { name: string; dbName?: string }[]
}

// parses the schema into scalar fields, relations and an array of foreign keys
export const parseSchema = async (model: string) => {
  const schemaResult = await getSchema(model)

  if (!isServiceModel(schemaResult)) {
    throw new Error(
      `No schema definition found for \`${model}\` in schema.prisma file`,
    )
  }

  const schema = schemaResult

  const relations: Record<string, { foreignKey: string[]; type: string }> = {}
  let foreignKeys: string[] = []

  // aggregate the plain String, Int and DateTime fields
  const scalarFields = schema.fields.filter((field: PrismaField) => {
    if (field.relationFromFields) {
      // only build relations for those that are required
      if (field.isRequired && field.relationFromFields.length !== 0) {
        relations[field.name] = {
          foreignKey: field.relationFromFields,
          type: field.type,
        }
      }
      foreignKeys = foreignKeys.concat(field.relationFromFields)
    }

    return (
      field.isRequired &&
      !field.hasDefaultValue && // don't include fields that the database will default
      !field.relationName // this field isn't a relation (ie. comment.post)
    )
  })

  // Computed from the full field list, not just `scalarFields` — optional
  // fields like `resetToken` count towards a model being auth-related
  const redactedFields = redactedModelFields(
    schema.fields.map((field: PrismaField) => field.name),
  )

  return { scalarFields, relations, foreignKeys, redactedFields }
}

export function scenarioFieldValue(field: PrismaField) {
  const randFloat = Math.random() * 10000000
  const randInt = parseInt(String(Math.random() * 10000000))
  const randIntArray = [
    parseInt(String(Math.random() * 300)),
    parseInt(String(Math.random() * 300)),
    parseInt(String(Math.random() * 300)),
  ]

  switch (field.type) {
    case 'BigInt':
      return `${BigInt(randInt)}n`
    case 'Boolean':
      return true
    case 'DateTime':
      return new Date()
    case 'Decimal':
    case 'Float':
      return randFloat
    case 'Int':
      return randInt
    case 'Json':
      return { foo: 'bar' }
    case 'String':
      if (field.name?.toLowerCase().includes('email')) {
        return field.isUnique ? `foo${randInt}@bar.com` : 'foo@bar.com'
      }

      return field.isUnique ? `String${randInt}` : 'String'
    case 'Bytes':
      return `new Uint8Array([${randIntArray}])`
    default: {
      if (field.kind === 'enum' && field.enumValues?.[0]) {
        return field.enumValues[0].dbName || field.enumValues[0].name
      }
    }
  }

  return undefined
}

export const fieldsToScenario = async (
  scalarFields: PrismaField[],
  relations: Record<string, { foreignKey: string[]; type: string }>,
  foreignKeys: string[],
): Promise<Record<string, unknown>> => {
  const data: Record<string, unknown> = {}

  // remove foreign keys from scalars
  scalarFields.forEach((field) => {
    if (!foreignKeys.length || !foreignKeys.includes(field.name)) {
      data[field.name] = scenarioFieldValue(field)
    }
  })

  // add back in related models by name so they can be created with prisma create syntax
  for (const [relationName, relData] of Object.entries(relations)) {
    const relationModelName = relData.type
    const {
      scalarFields: relScalarFields,
      relations: relRelations,
      foreignKeys: relForeignKeys,
    } = await parseSchema(relationModelName)

    data[relationName] = {
      create: await fieldsToScenario(
        relScalarFields,
        relRelations,
        relForeignKeys,
      ),
    }
  }

  return data
}

// creates the scenario data based on the data definitions in schema.prisma
export const buildScenario = async (model: string) => {
  const scenarioModelName = camelcase(model)
  const standardScenario: Record<
    string,
    Record<string, { data?: Record<string, unknown> }>
  > = {
    [scenarioModelName]: {},
  }
  const { scalarFields, relations, foreignKeys } = await parseSchema(model)

  // turn scalar fields into actual scenario data
  for (const name of DEFAULT_SCENARIO_NAMES) {
    standardScenario[scenarioModelName][name] = {}

    const scenarioData = await fieldsToScenario(
      scalarFields,
      relations,
      foreignKeys,
    )

    Object.keys(scenarioData).forEach((key) => {
      const value = scenarioData[key]

      // Support BigInt
      if (value && typeof value === 'string' && value.match(/^\d+n$/)) {
        scenarioData[key] = `${value.slice(0, value.length - 1)}n`
      }
    })

    standardScenario[scenarioModelName][name].data = scenarioData
  }

  return standardScenario
}

// creates the scenario data based on the data definitions in schema.prisma
// and transforms data types to strings and other values that are compatible with Prisma
export const buildStringifiedScenario = async (model: string) => {
  const scenario = await buildScenario(model)

  const jsonString = JSON.stringify(scenario, (_key, value: unknown) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (typeof value === 'string' && value.match(/^\d+n$/)) {
      return Number(value.slice(0, value.length - 1))
    }

    return value
  })

  // Not all values can be represented as JSON, like constructor invocations
  return jsonString.replace(
    /"new Uint8Array\(([^)]+)\)"/g,
    'new Uint8Array($1)',
  )
}

export const fieldTypes = async (model: string) => {
  const { scalarFields } = await parseSchema(model)

  // Example value
  // {
  //   name: 'score',
  //   kind: 'scalar',
  //   isList: false,
  //   isRequired: true,
  //   isUnique: false,
  //   isId: false,
  //   isReadOnly: false,
  //   hasDefaultValue: false,
  //   type: 'Int',
  //   isGenerated: false,
  //   isUpdatedAt: false
  // }
  return scalarFields.reduce(
    (acc: Record<string, string>, value: PrismaField) => {
      acc[value.name] = value.type
      return acc
    },
    {},
  )
}

// outputs fields necessary to create an object in the test file
export const fieldsToInput = async (model: string) => {
  const { scalarFields, foreignKeys, redactedFields } = await parseSchema(model)
  const modelName = camelcase(singularize(model))
  const inputObj: Record<string, unknown> = {}

  // `scalarFields` only contains required fields without defaults, so if any
  // of them is a field the SDL generator excludes from the GraphQL input
  // types (see `redactedModelFields`), creating a record through the
  // generated create input can't succeed. Skip the create test entirely.
  if (
    scalarFields.some((field: PrismaField) =>
      redactedFields.includes(field.name),
    )
  ) {
    return false
  }

  scalarFields.forEach((field: PrismaField) => {
    if (foreignKeys.includes(field.name)) {
      inputObj[field.name] = `scenario.${modelName}.two.${field.name}`
    } else {
      inputObj[field.name] = scenarioFieldValue(field)
    }
  })

  if (Object.keys(inputObj).length > 0) {
    return inputObj
  } else {
    return false
  }
}

// outputs fields necessary to update an object in the test file
export const fieldsToUpdate = async (model: string) => {
  const { scalarFields, relations, foreignKeys, redactedFields } =
    await parseSchema(model)
  const modelName = camelcase(singularize(model))
  let field: PrismaField | undefined,
    newValue: unknown,
    fieldName: string | string[]

  // never pick a field the SDL generator excludes from the GraphQL input
  // types (see `redactedModelFields`) — it won't exist in the generated
  // UpdateInput type
  const updatableFields = scalarFields.filter(
    (scalar: PrismaField) => !redactedFields.includes(scalar.name),
  )

  // find an editable scalar field, ideally one that isn't a foreign key
  field = updatableFields.find(
    (scalar: PrismaField) => !foreignKeys.includes(scalar.name),
  )

  // no non-foreign keys, so just take the first one
  if (!field) {
    field = updatableFields[0]
  }

  // if the model has no editable scalar fields, skip update test completely
  if (!field) {
    return false
  }

  if (foreignKeys.includes(field.name)) {
    // no scalar fields, change a relation field instead
    // { post: { foreignKey: [ 'postId' ], type: "Post" }, tag: { foreignKey: [ 'tagId' ], type: "Post" } }
    fieldName = Object.values(relations)[0].foreignKey
    newValue = `scenario.${modelName}.two.${field.name}`
  } else {
    fieldName = field.name

    // change scalar fields
    const value = scenarioFieldValue(field)
    newValue = value

    // depending on the field type, append/update the value to something different
    switch (field.type) {
      case 'BigInt':
        if (typeof value === 'bigint') {
          newValue = `${value + 1n}`
        }
        break
      case 'Boolean': {
        newValue = !value
        break
      }
      case 'DateTime': {
        const date = new Date()
        date.setDate(date.getDate() + 1)
        newValue = date
        break
      }
      case 'Decimal':
      case 'Float': {
        if (typeof value === 'number') {
          newValue = value + 1.1
        }
        break
      }
      case 'Int': {
        if (typeof value === 'number') {
          newValue = value + 1
        }
        break
      }
      case 'Json': {
        newValue = { foo: 'baz' }
        break
      }
      case 'String': {
        if (typeof value === 'string') {
          newValue = value + '2'
        }
        break
      }
      default: {
        if (
          field.kind === 'enum' &&
          field.enumValues?.[field.enumValues.length - 1]
        ) {
          const enumVal = field.enumValues[field.enumValues.length - 1]
          newValue = enumVal.dbName || enumVal.name
        }
        break
      }
    }
  }

  if (Array.isArray(fieldName)) {
    // Composite FK: spread one entry per key so the test scenario object has
    // the correct shape (e.g. { postId: value, tagId: value }).
    return Object.fromEntries(fieldName.map((key) => [key, newValue]))
  }
  return { [fieldName]: newValue }
}

const getIdName = async (
  model: string,
): Promise<string | CompositeIdName | undefined> => {
  const schemaResult = await getSchema(model)

  if (!isServiceModel(schemaResult)) {
    return undefined
  }

  // Compound `@@id([a, b])` keys don't have a single field with `isId: true`
  // -- Prisma puts them on `primaryKey.fields` instead.
  if (schemaResult.primaryKey?.fields.length) {
    const { fields, name } = schemaResult.primaryKey
    return { fields, whereArg: name || fields.join('_') }
  }

  return schemaResult.fields.find((field: PrismaField) => field.isId)?.name
}

interface FilesArgs {
  name: string
  tests?: boolean
  relations?: string[]
  typescript?: boolean
  crud?: boolean
}

export const files = async ({
  name,
  tests,
  relations,
  typescript,
  ...rest
}: FilesArgs) => {
  const componentName = camelcase(pluralize(name))
  const model = name
  const idName = await getIdName(model)

  // The query/mutation/relation-resolver blocks in service.ts.template
  // support compound `@@id([...])` keys, but the generated test file's
  // CRUD scenarios don't know how to build a compound `where` value or
  // scenario id lookup yet -- so give a clear error instead of emitting
  // broken tests.
  if (
    tests &&
    rest.crud &&
    idName !== undefined &&
    typeof idName !== 'string'
  ) {
    throw new Error(
      `Cannot generate CRUD tests for "${model}": it has a compound primary ` +
        `key (@@id([${idName.fields.join(', ')}])), which isn't supported ` +
        'by the generated test file yet. Re-run with `--tests=false`.',
    )
  }

  const prismaImportSource = 'src/lib/db'

  let modelRelations: string[] | undefined

  if (relations) {
    modelRelations = relations
  } else {
    const schemaResult = await getSchema(model)

    if (isServiceModel(schemaResult)) {
      modelRelations = relationsForModel(schemaResult)
    }
  }

  const serviceFile = await templateForFile({
    name,
    side: 'api',
    sidePathSection: 'services',
    generator: 'service',
    outputPath: path.join(componentName, componentName + '.ts'),
    templatePath: 'service.ts.template',
    templateVars: {
      relations: modelRelations,
      idName,
      prismaImportSource,
      ...rest,
    },
  })

  const files = [serviceFile]

  // Only render the test/scenarios templates when they're actually needed --
  // besides being wasted work, `test.ts.template` interpolates `idName`
  // directly (unlike `service.ts.template`, it doesn't support compound
  // `@@id([...])` keys), so rendering it unconditionally would blow up on
  // the compound-id models the guard above is meant to protect against.
  if (tests) {
    const testFile = await templateForFile({
      name,
      side: 'api',
      sidePathSection: 'services',
      generator: 'service',
      outputPath: path.join(componentName, componentName + '.test.ts'),
      templatePath: 'test.ts.template',
      templateVars: {
        relations: relations || [],
        create: await fieldsToInput(model),
        update: await fieldsToUpdate(model),
        types: await fieldTypes(model),
        prismaImport: (await parseSchema(model)).scalarFields.some(
          (field: PrismaField) => field.type === 'Decimal',
        ),
        prismaModel: model,
        idName,
        prismaImportSource,
        ...rest,
      },
    })

    const scenariosFile = await templateForFile({
      name,
      side: 'api',
      sidePathSection: 'services',
      generator: 'service',
      outputPath: path.join(componentName, componentName + '.scenarios.ts'),
      templatePath: 'scenarios.ts.template',
      templateVars: {
        scenario: await buildScenario(model),
        stringifiedScenario: await buildStringifiedScenario(model),
        prismaModel: model,
        idName,
        relations: modelRelations,
        prismaImportSource,
        ...rest,
      },
    })

    files.push(testFile)
    files.push(scenariosFile)
  }

  // Returns
  // {
  //    "path/to/fileA": "<<<template>>>",
  //    "path/to/fileB": "<<<template>>>",
  // }
  return files.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    if (!typescript) {
      content = await transformTSToJS(outputPath, content)
      outputPath = outputPath.replace('.ts', '.js')
    }

    return {
      [outputPath]: content,
      ...acc,
    }
  }, Promise.resolve<Record<string, string>>({}))
}

export const handler = createHandler({
  componentName: 'service',
  preTasksFn: verifyModelName,
  filesFn: files,
})
