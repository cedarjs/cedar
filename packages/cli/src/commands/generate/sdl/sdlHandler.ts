import ansis from 'ansis'
import boxen from 'boxen'
import camelcase from 'camelcase'
import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { generate as generateTypes } from '@cedarjs/internal/dist/generate/generate'
import { getConfig } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'
import { pluralize } from '@cedarjs/utils/cedarPluralize'

import { transformTSToJS, writeFilesTask } from '../../../lib/index.js'
import {
  prepareForRollback,
  addFunctionToRollback,
} from '../../../lib/rollback.js'
import {
  getSchema,
  getEnum,
  verifyModelName,
} from '../../../lib/schemaHelpers.js'
import { relationsForModel } from '../helpers.js'
import { files as serviceFiles } from '../service/serviceHandler.js'
import { templateForFile } from '../yargsHandlerHelpers.js'

const DEFAULT_IGNORE_FIELDS_FOR_INPUT = ['createdAt', 'updatedAt']

const missingIdConsoleMessage = () => {
  const line1 =
    ansis.bold.yellow('WARNING') +
    ': Cannot generate CRUD SDL without an `@id` database column.'
  const line2 = 'If you are trying to generate for a many-to-many join table '
  const line3 = "you'll need to update your schema definition to include"
  const line4 = 'an `@id` column. Read more here: '
  const line5 = ansis.underline.blue(
    'https://cedarjs.com/docs/schema-relations',
  )

  console.error(
    boxen(line1 + '\n\n' + line2 + '\n' + line3 + '\n' + line4 + '\n' + line5, {
      padding: 1,
      margin: { top: 1, bottom: 3, right: 1, left: 2 },
      borderStyle: 'single',
    }),
  )
}

const addFieldGraphQLComment = (
  field: { documentation?: string; name: string },
  str: string,
): string => {
  const description = field.documentation || `Description for ${field.name}.`

  return `
  "${description}"
  ${str}`
}

const modelFieldToSDL = ({
  field,
  required = true,
  types = {},
  docs = false,
}: {
  field: {
    name: string
    type: string
    kind: string
    isList: boolean
    isRequired: boolean
    isId: boolean
    documentation?: string
  }
  required?: boolean
  types?: Record<string, unknown>
  docs?: boolean
}): string => {
  if (Object.entries(types).length) {
    field.type =
      field.kind === 'object' ? idType(types[field.type]) : field.type
  }

  const prismaTypeToGraphqlType: Record<string, string> = {
    Json: 'JSON',
    Decimal: 'Float',
    Bytes: 'Byte',
  }

  const gqlType = prismaTypeToGraphqlType[field.type] || field.type
  const type = field.isList ? `[${gqlType}]` : gqlType
  // lists and id fields are always required (lists can be empty, that's fine)
  const isRequired =
    (field.isRequired && required) || field.isList || field.isId
  const fieldContent = `${field.name}: ${type}${isRequired ? '!' : ''}`

  if (docs) {
    return addFieldGraphQLComment(field, fieldContent)
  } else {
    return fieldContent
  }
}

const querySDL = (model: { fields: unknown[] }, docs = false) => {
  return model.fields.map((field) => modelFieldToSDL({ field: field as Parameters<typeof modelFieldToSDL>[0]['field'], docs }))
}

const inputSDL = (
  model: { fields: Array<{ name: string; isId: boolean; default?: unknown; kind: string }> },
  required: boolean,
  types = {},
  docs = false,
) => {
  const ignoredFields = DEFAULT_IGNORE_FIELDS_FOR_INPUT

  return model.fields
    .filter((field) => {
      const idField = model.fields.find((field) => field.isId)

      // Only ignore the id field if it has a default value
      if (idField && idField.default) {
        ignoredFields.push(idField.name)
      }

      return ignoredFields.indexOf(field.name) === -1 && field.kind !== 'object'
    })
    .map((field) => modelFieldToSDL({ field: field as Parameters<typeof modelFieldToSDL>[0]['field'], required, types, docs }))
}

const idInputSDL = (idType: unknown, docs: boolean) => {
  if (!Array.isArray(idType)) {
    return []
  }
  return idType.map((field) =>
    modelFieldToSDL({ field: field as Parameters<typeof modelFieldToSDL>[0]['field'], required: true, types: {}, docs }),
  )
}

// creates the CreateInput type (all fields are required)
const createInputSDL = (model: Parameters<typeof inputSDL>[0], types = {}, docs = false) => {
  return inputSDL(model, true, types, docs)
}

// creates the UpdateInput type (not all fields are required)
const updateInputSDL = (model: Parameters<typeof inputSDL>[0], types = {}, docs = false) => {
  return inputSDL(model, false, types, docs)
}

const idType = (model: { fields: Array<{ isId: boolean; type: string }>; primaryKey?: { fields: string[] } }, crud?: boolean): unknown => {
  if (!crud) {
    return undefined
  }

  // When using a composite primary key, we need to return an array of fields
  if (model.primaryKey?.fields.length) {
    const { fields: fieldNames } = model.primaryKey
    return fieldNames.map((name) => model.fields.find((f) => f.name === name))
  }

  const idField = model.fields.find((field) => field.isId)

  if (!idField) {
    missingIdConsoleMessage()
    throw new Error('Failed: Could not generate SDL')
  }
  return idField.type
}

const idName = (model: { fields: Array<{ isId: boolean; name: string }> }, crud?: boolean): string | undefined => {
  if (!crud) {
    return undefined
  }

  const idField = model.fields.find((field) => field.isId)
  if (!idField) {
    missingIdConsoleMessage()
    throw new Error('Failed: Could not generate SDL')
  }
  return idField.name
}

const sdlFromSchemaModel = async (name: string, crud: boolean, docs = false) => {
  const model = await getSchema(name)

  // get models for referenced user-defined types
  const types = (
    await Promise.all(
      model.fields
        .filter((field) => field.kind === 'object')
        .map(async (field) => {
          const model = await getSchema(field.type)
          return model
        }),
    )
  ).reduce((acc, cur) => ({ ...acc, [cur.name]: cur }), {} as Record<string, unknown>)

  // Get enum definition and fields from user-defined types
  const enums = (
    await Promise.all(
      model.fields
        .filter((field) => field.kind === 'enum')
        .map(async (field) => {
          const enumDef = await getEnum(field.type)
          return enumDef
        }),
    )
  ).reduce((acc, curr) => acc.concat(curr), [] as unknown[])

  const modelName = model.name
  const modelDescription =
    model.documentation || `Representation of ${modelName}.`

  const idTypeRes = idType(model, crud)

  return {
    modelName,
    modelDescription,
    query: querySDL(model, docs).join('\n    '),
    createInput: createInputSDL(model, types, docs).join('\n    '),
    updateInput: updateInputSDL(model, types, docs).join('\n    '),
    idInput: idInputSDL(idTypeRes, docs).join('\n    '),
    idType: idType(model, crud),
    idName: idName(model, crud),
    relations: relationsForModel(model),
    enums,
  }
}

export const files = async ({
  name,
  crud = true,
  docs = false,
  tests,
  typescript,
}: {
  name: string
  crud?: boolean
  docs?: boolean
  tests?: boolean
  typescript?: boolean
}) => {
  const extension = typescript ? 'ts' : 'js'
  const sdlData = await sdlFromSchemaModel(name, crud, docs)

  const [outputPath, content] = await templateForFile({
    name,
    side: 'api',
    sidePathSection: 'graphql',
    generator: 'sdl',
    templatePath: 'sdl.ts.template',
    templateVars: { docs, name, crud, ...sdlData },
    outputPath: `${camelcase(pluralize(name))}.sdl.${extension}`,
  })

  const template = typescript
    ? content
    : await transformTSToJS(outputPath, content)

  return {
    [outputPath]: template,
    ...(await serviceFiles({
      name,
      crud,
      tests,
      relations: sdlData.relations,
      typescript,
    })),
  }
}

// TODO: Add --dry-run command
export const handler = async ({
  model,
  crud,
  force,
  tests,
  typescript,
  docs,
  rollback,
}: {
  model: string
  crud: boolean
  force: boolean
  tests?: boolean
  typescript?: boolean
  docs: boolean
  rollback: boolean
}) => {
  if (tests === undefined) {
    tests = getConfig().generate.tests
  }

  recordTelemetryAttributes({
    command: 'generate sdl',
    crud,
    force,
    tests,
    typescript,
    docs,
    rollback,
  })

  try {
    const { name } = await verifyModelName({ name: model })

    const tasks = new Listr(
      [
        {
          title: 'Generating SDL files...',
          task: async () => {
            const f = await files({ name, tests, crud, typescript, docs })
            return writeFilesTask(f, { overwriteExisting: force })
          },
        },
        {
          title: `Generating types ...`,
          task: async () => {
            const { errors } = await generateTypes()

            for (const { message, error } of errors) {
              console.error(message)
              console.log()
              console.error(error)
              console.log()
            }

            addFunctionToRollback(generateTypes, true)
          },
        },
      ].filter(Boolean),
      {
        rendererOptions: { collapseSubtasks: false },
        exitOnError: true,
        silentRendererCondition: process.env.NODE_ENV === 'test',
      },
    )

    if (rollback && !force) {
      prepareForRollback(tasks)
    }
    await tasks.run()
  } catch (e: unknown) {
    const err = e as { message: string; exitCode?: number }
    errorTelemetry(process.argv, err.message)
    console.error(c.error(err.message))
    process.exit(err?.exitCode || 1)
  }
}
