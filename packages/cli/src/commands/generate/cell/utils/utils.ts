import pascalcase from 'pascalcase'

import { listQueryTypeFieldsInProject } from '@cedarjs/internal/dist/gql'

export const getCellOperationNames = async (): Promise<string[]> => {
  const { getProject } = await import('@cedarjs/structure')

  return getProject()
    .cells.map((x) => {
      return x.queryOperationName
    })
    .filter(Boolean) as string[]
}

export const uniqueOperationName = async (
  name: string,
  { index = 1, list = false }: { index?: number; list?: boolean },
): Promise<string> => {
  let operationName = pascalcase(
    index <= 1 ? `find_${name}_query` : `find_${name}_query_${index}`,
  )

  if (list) {
    operationName =
      index <= 1
        ? `${pascalcase(name)}Query`
        : `${pascalcase(name)}Query_${index}`
  }

  const cellOperationNames = await getCellOperationNames()
  if (!cellOperationNames.includes(operationName)) {
    return operationName
  }
  return uniqueOperationName(name, { index: index + 1 })
}

export const operationNameIsUnique = async (
  operationName: string,
): Promise<boolean> => {
  const cellOperationNames = await getCellOperationNames()
  return !cellOperationNames.includes(operationName)
}

interface PrismaField {
  isId: boolean
  type: string
  name: string
}

interface PrismaModel {
  fields: PrismaField[]
}

export const getIdType = (model: PrismaModel): string | undefined => {
  return model.fields.find((field) => field.isId)?.type
}

export const getIdName = (model: PrismaModel): string | undefined => {
  return model.fields.find((field) => field.isId)?.name
}

/**
 * This function checks the project for the field name supplied,
 * assuming the schema file has been generated in .cedar/schema.graphql
 * @example
 * checkProjectForQueryField('blogPost') => true/false
 * checkProjectForQueryField('cedar') => true
 *
 **/
export const checkProjectForQueryField = async (
  queryFieldName: string,
): Promise<boolean> => {
  const queryFields = await listQueryTypeFieldsInProject()

  return queryFields.includes(queryFieldName)
}
