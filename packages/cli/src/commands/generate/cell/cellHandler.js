import pascalcase from 'pascalcase'

import { generate as generateTypes } from '@cedarjs/internal/dist/generate/generate'

import { nameVariants, transformTSToJS } from '../../../lib/index.js'
import { isWordPluralizable } from '../../../lib/pluralHelpers.js'
import { addFunctionToRollback } from '../../../lib/rollback.js'
import { isPlural, singularize } from '../../../lib/rwPluralize.js'
import { getSchema } from '../../../lib/schemaHelpers.js'
import { forcePluralizeWord, removeGeneratorName } from '../helpers.js'
import {
  createHandler,
  templateForComponentFile,
} from '../yargsHandlerHelpers.js'

import {
  checkProjectForQueryField,
  getIdName,
  getIdType,
  operationNameIsUnique,
  uniqueOperationName,
} from './utils/utils.js'

const COMPONENT_SUFFIX = 'Cell'
const REDWOOD_WEB_PATH_NAME = 'components'

export const files = async ({ name, typescript, ...argv }) => {
  let cellName = removeGeneratorName(name, 'cell')
  let idName = 'id'
  let idType,
    mockIdValues = [42, 43, 44],
    model = null
  let templateNameSuffix = ''
  let typeName = cellName
  // Create a unique operation name.

  const shouldGenerateList =
    (isWordPluralizable(cellName) ? isPlural(cellName) : argv.list) || argv.list

  // needed for the singular cell GQL query find by id case
  try {
    // todo should pull from graphql schema rather than prisma!
    model = await getSchema(pascalcase(singularize(cellName)))
    idName = getIdName(model)
    idType = getIdType(model)
    typeName = model.name
    mockIdValues =
      idType === 'String'
        ? mockIdValues.map((value) => `'${value}'`)
        : mockIdValues
  } catch {
    // Eat error so that the destroy cell generator doesn't raise an error
    // when trying to find prisma query engine in test runs.

    // Assume id will be Int, otherwise generated cell will keep throwing
    idType = 'Int'
  }

  if (shouldGenerateList) {
    cellName = forcePluralizeWord(cellName)
    templateNameSuffix = 'List'
    // override operationName so that its find_operationName
  }

  let operationName = argv.query
  if (operationName) {
    const userSpecifiedOperationNameIsUnique =
      await operationNameIsUnique(operationName)
    if (!userSpecifiedOperationNameIsUnique) {
      throw new Error(`Specified query name: "${operationName}" is not unique!`)
    }
  } else {
    operationName = await uniqueOperationName(cellName, {
      list: shouldGenerateList,
    })
  }

  const extension = typescript ? '.tsx' : '.jsx'
  const cellFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: `cell${templateNameSuffix}.tsx.template`,
    templateVars: {
      operationName,
      idName,
      idType,
    },
  })

  const testFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: `.test${extension}`,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: 'test.js.template',
    templateVars: {
      idName: shouldGenerateList ? undefined : idName,
      mockIdValues: shouldGenerateList ? undefined : mockIdValues,
    },
  })

  const storiesFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: `.stories${extension}`,
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: 'stories.tsx.template',
  })

  const mockFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: typescript ? '.mock.ts' : '.mock.js',
    webPathSection: REDWOOD_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: `mock${templateNameSuffix}.ts.template`,
    templateVars: {
      idName,
      mockIdValues,
      typeName,
    },
  })

  const files = [cellFile]

  if (argv.stories) {
    files.push(storiesFile)
  }

  if (argv.tests) {
    files.push(testFile)
  }

  if (argv.stories || argv.tests) {
    files.push(mockFile)
  }

  // Returns
  // {
  //    "path/to/fileA": "<<<template>>>",
  //    "path/to/fileB": "<<<template>>>",
  // }
  return files.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template = typescript
      ? content
      : await transformTSToJS(outputPath, content)

    return {
      [outputPath]: template,
      ...acc,
    }
  }, Promise.resolve({}))
}

export const handler = createHandler({
  componentName: 'cell',
  filesFn: files,
  includeAdditionalTasks: ({ name: cellName }) => {
    return [
      {
        title: `Generating types ...`,
        task: async (_ctx, task) => {
          const queryFieldName = nameVariants(
            removeGeneratorName(cellName, 'cell'),
          ).camelName
          const projectHasSdl = await checkProjectForQueryField(queryFieldName)

          if (projectHasSdl) {
            const { errors } = await generateTypes()

            for (const { message, error } of errors) {
              console.error(message)
              console.log()
              console.error(error)
              console.log()
            }

            addFunctionToRollback(generateTypes, true)
          } else {
            task.skip(
              'Skipping type generation: no SDL defined for ' +
                `"${queryFieldName}". To generate types, run ` +
                `'yarn cedar generate sdl ${queryFieldName}'.`,
            )
          }
        },
      },
    ]
  },
})
