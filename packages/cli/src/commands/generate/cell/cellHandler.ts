import pascalcase from 'pascalcase'

import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { generate as generateTypes } from '@cedarjs/internal/dist/generate/generate'
import { isPlural, singularize } from '@cedarjs/utils/cedarPluralize'

import { nameVariants, transformTSToJSMap } from '../../../lib/index.js'
import { isWordPluralizable } from '../../../lib/pluralHelpers.js'
import { addFunctionToRollback } from '../../../lib/rollback.js'
// @ts-expect-error - No types for JS files
import { getSchema } from '../../../lib/schemaHelpers.js'
import { forcePluralizeWord, removeGeneratorName } from '../helpers.js'
import {
  createHandler,
  templateForComponentFile,
} from '../yargsHandlerHelpers.js'
import type { TypescriptHandlerArgv } from '../yargsHandlerHelpers.js'

import {
  checkProjectForQueryField,
  getIdName,
  getIdType,
  operationNameIsUnique,
  uniqueOperationName,
} from './utils/utils.js'

const COMPONENT_SUFFIX = 'Cell'
const CEDAR_WEB_PATH_NAME = 'components'

type CellArgv = TypescriptHandlerArgv & {
  list?: boolean
  query?: string
  beforeQuery?: boolean
  afterQuery?: boolean
  isEmpty?: boolean
  fragment?: string
}

export const files = async ({
  name,
  typescript = false,
  list = false,
  query,
  stories,
  tests,
  beforeQuery = false,
  afterQuery = false,
  isEmpty = false,
  fragment = '',
}: CellArgv): Promise<Record<string, string>> => {
  let cellName = removeGeneratorName(name, 'cell')
  let idName: string | undefined = 'id'
  let idType: string | undefined
  let mockIdValues: (number | string)[] = [42, 43, 44]
  let model = null
  let templateNameSuffix = ''
  let typeName = cellName
  // Create a unique operation name.

  if (fragment) {
    if (list) {
      throw new Error(
        'The --list flag cannot be combined with --fragment; fragment cells always render a single item.',
      )
    }
    if (beforeQuery) {
      throw new Error(
        'The --before-query flag cannot be combined with --fragment; fragment cells never fire a query of their own.',
      )
    }
    if (query) {
      throw new Error(
        "The --query flag cannot be combined with --fragment; fragment cells don't have an operation name.",
      )
    }
  }

  const shouldGenerateList =
    !fragment &&
    ((isWordPluralizable(cellName) ? isPlural(cellName) : list) || list)

  // needed for the singular cell GQL query find by id case
  if (!fragment) {
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
  }

  if (shouldGenerateList) {
    cellName = forcePluralizeWord(cellName)
    templateNameSuffix = 'List'
    // override operationName so that its find_operationName
  }

  let operationName: string | undefined = query
  let fragmentName: string | undefined
  let fragmentOnType: string | undefined
  let fragmentPropName: string | undefined

  if (fragment) {
    // The data prop (and fragment name suffix) is derived from the GraphQL
    // type the fragment selects from, matching createFragmentCell's own
    // fallback naming (see getFragmentPropName in createFragmentCell.tsx).
    const fragmentTypeVariants = nameVariants(fragment)
    fragmentOnType = fragmentTypeVariants.pascalName
    fragmentPropName = fragmentTypeVariants.camelName
    fragmentName = `${nameVariants(cellName).pascalName}Cell_${fragmentPropName}`
  } else if (operationName) {
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
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: fragment
      ? 'cellFragment.tsx.template'
      : `cell${templateNameSuffix}.tsx.template`,
    templateVars: fragment
      ? {
          fragmentName,
          fragmentOnType,
          camelName: fragmentPropName,
          afterQuery,
          isEmpty,
        }
      : {
          operationName,
          idName,
          idType,
          beforeQuery,
          afterQuery,
          isEmpty,
        },
  })

  const testFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: `.test${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: fragment ? 'testFragment.js.template' : 'test.js.template',
    templateVars: fragment
      ? { camelName: fragmentPropName }
      : {
          idName: shouldGenerateList ? undefined : idName,
          mockIdValues: shouldGenerateList ? undefined : mockIdValues,
        },
  })

  const storiesFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: `.stories${extension}`,
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: fragment
      ? 'storiesFragment.tsx.template'
      : 'stories.tsx.template',
  })

  const mockFile = await templateForComponentFile({
    name: cellName,
    suffix: COMPONENT_SUFFIX,
    extension: typescript ? '.mock.ts' : '.mock.js',
    webPathSection: CEDAR_WEB_PATH_NAME,
    generator: 'cell',
    templatePath: `mock${templateNameSuffix}.ts.template`,
    templateVars: fragment
      ? {
          idName,
          mockIdValues,
          typeName: fragmentOnType,
          camelName: fragmentPropName,
        }
      : {
          idName,
          mockIdValues,
          typeName,
        },
  })

  const files = [cellFile]

  if (stories) {
    files.push(storiesFile)
  }

  if (tests) {
    files.push(testFile)
  }

  if (stories || tests) {
    files.push(mockFile)
  }

  return transformTSToJSMap(files, typescript)
}

export const handler = createHandler({
  componentName: 'cell',
  filesFn: files,
  includeAdditionalTasks: ({
    name: cellName,
    fragment,
  }: {
    name: string
    fragment?: string
  }) => {
    return [
      {
        title: `Generating types ...`,
        task: async (_ctx: unknown, task: { skip: (msg: string) => void }) => {
          const queryFieldName = nameVariants(
            removeGeneratorName(cellName, 'cell'),
          ).camelName
          // Fragment cells aren't backed by a query field on the Query type,
          // so there's no SDL field to check for - always generate types.
          const projectHasSdl =
            Boolean(fragment) ||
            (await checkProjectForQueryField(queryFieldName))

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
                `'${formatCedarCommand(['generate', 'sdl', queryFieldName])}'.`,
            )
          }
        },
      },
    ]
  },
})
