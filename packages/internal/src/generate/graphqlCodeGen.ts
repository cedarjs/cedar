import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as addPlugin from '@graphql-codegen/add'
import { loadCodegenConfig } from '@graphql-codegen/cli'
import { codegen } from '@graphql-codegen/core'
import type {
  Types as CodegenTypes,
  CodegenPlugin,
} from '@graphql-codegen/plugin-helpers'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperations from '@graphql-codegen/typescript-operations'
import { CodeFileLoader } from '@graphql-tools/code-file-loader'
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader'
import { loadDocuments, loadSchemaSync } from '@graphql-tools/load'
import type { LoadTypedefsOptions } from '@graphql-tools/load'
import execa from 'execa'
import { Kind, type DocumentNode } from 'graphql'

import {
  getPaths,
  getConfig,
  resolveGeneratedPrismaClient,
} from '@cedarjs/project-config'

import { getTsConfigs, dbReexportsPrismaClient } from '../project.js'

import * as rwTypescriptResolvers from './plugins/rw-typescript-resolvers/index.js'
enum CodegenSide {
  API,
  WEB,
}

type TypeDefResult = {
  typeDefFiles: string[]
  errors: { message: string; error: unknown }[]
}

export const generateTypeDefGraphQLApi = async (): Promise<TypeDefResult> => {
  const config = getConfig()
  const errors: { message: string; error: unknown }[] = []

  if (config.experimental.useSDLCodeGenForGraphQLTypes) {
    const paths = getPaths()
    const sdlCodegen = await import('@sdl-codegen/node')

    const dtsFiles: string[] = []

    try {
      const output = await sdlCodegen.runFullCodegen('redwood', { paths })
      dtsFiles.push(...output.paths)
    } catch (e: unknown) {
      if (e instanceof Error) {
        errors.push({ message: e.message, error: e })
      } else {
        throw e
      }
    }

    return {
      typeDefFiles: dtsFiles,
      errors,
    }
  }

  const filename = path.join(getPaths().api.types, 'graphql.d.ts')
  const prismaModels = await getPrismaModels()
  const prismaImports = Object.keys(prismaModels).map((key) => {
    return `${key} as Prisma${key}`
  })

  const prismaImportSource = dbReexportsPrismaClient()
    ? 'src/lib/db'
    : '@prisma/client'

  const extraPlugins: CombinedPluginConfig[] = [
    {
      name: 'add',
      options: {
        content: [
          `import { Prisma } from "${prismaImportSource}"`,
          "import { MergePrismaWithSdlTypes, MakeRelationsOptional } from '@cedarjs/api'",
          `import { ${prismaImports.join(', ')} } from '${prismaImportSource}'`,
        ],
        placement: 'prepend',
      },
      codegenPlugin: addPlugin,
    },
    {
      name: 'print-mapped-models',
      options: {},
      codegenPlugin: printMappedModelsPlugin,
    },
    {
      name: 'typescript-resolvers',
      options: {},
      codegenPlugin: rwTypescriptResolvers,
    },
  ]

  try {
    return {
      typeDefFiles: await runCodegenGraphQL(
        [],
        extraPlugins,
        filename,
        CodegenSide.API,
      ),
      errors,
    }
  } catch (e) {
    errors.push({
      message: 'Error: Could not generate GraphQL type definitions (api)',
      error: e,
    })

    return {
      typeDefFiles: [],
      errors,
    }
  }
}

export const generateTypeDefGraphQLWeb = async (): Promise<TypeDefResult> => {
  const filename = path.join(getPaths().web.types, 'graphql.d.ts')
  const options = getLoadDocumentsOptions(filename)
  const documentsGlob = './web/src/**/!(*.d).{ts,tsx,js,jsx}'

  let documents

  try {
    documents = await loadDocuments([documentsGlob], options)
  } catch {
    // No GraphQL documents present, no need to try to run codegen
    return {
      typeDefFiles: [],
      errors: [],
    }
  }

  const extraPlugins: CombinedPluginConfig[] = [
    {
      name: 'add',
      options: {
        content: `import { Prisma } from "${
          dbReexportsPrismaClient() ? '$api/src/lib/db' : '@prisma/client'
        }"`,
        placement: 'prepend',
      },
      codegenPlugin: addPlugin,
    },
    {
      name: 'typescript-operations',
      options: {},
      codegenPlugin: typescriptOperations,
    },
  ]

  const errors: { message: string; error: unknown }[] = []

  try {
    return {
      typeDefFiles: await runCodegenGraphQL(
        documents,
        extraPlugins,
        filename,
        CodegenSide.WEB,
      ),
      errors,
    }
  } catch (e) {
    errors.push({
      message: 'Error: Could not generate GraphQL type definitions (web)',
      error: e,
    })

    return {
      typeDefFiles: [],
      errors,
    }
  }
}

/**
 * This is the function used internally by generateTypeDefGraphQLApi and generateTypeDefGraphQLWeb
 * And contains the base configuration for generating gql types with codegen
 *
 * Named a little differently to make it easier to spot
 */
async function runCodegenGraphQL(
  documents: CodegenTypes.DocumentFile[],
  extraPlugins: CombinedPluginConfig[],
  filename: string,
  side: CodegenSide,
) {
  const userCodegenConfig = await loadCodegenConfig({
    configFilePath: getPaths().base,
  })

  const pluginConfig = await getPluginConfig(side)

  // Merge in user codegen config with the rw built-in one
  const mergedConfig = {
    ...pluginConfig,
    ...userCodegenConfig?.config?.config,
  }

  const options = getCodegenOptions(documents, mergedConfig, extraPlugins)
  const output = await codegen(options)

  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, output)

  return [filename]
}

export function getLoadDocumentsOptions(filename: string) {
  const loadTypedefsConfig: LoadTypedefsOptions<{ cwd: string }> = {
    cwd: getPaths().base,
    ignore: [filename],
    loaders: [new CodeFileLoader()],
    sort: true,
  }

  return loadTypedefsConfig
}

async function importGeneratedPrismaClient() {
  const cacheBuster = `?t=${Date.now()}`
  const prismaClientPath = await resolveGeneratedPrismaClient({
    mustExist: true,
  })
  const fileUrl = pathToFileURL(prismaClientPath).href + cacheBuster
  const freshPrisma = await import(fileUrl)

  return freshPrisma
}

type PrismaClientWithModelName = { ModelName: Record<string, string> }
type PrismaNamespaceWithModelName = {
  Prisma: PrismaClientWithModelName
}
type PrismaClientModule = {
  default?: unknown
} & Partial<PrismaClientWithModelName> &
  Partial<PrismaNamespaceWithModelName>

function isModelNameRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Object.values(value).every((entry) => typeof entry === 'string')
}

// TODO: This should be deterministic - get rid of this and just go straight to
// the value, wherever it might live
function getModelName(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const valueRecord = value as PrismaClientModule

  if (isModelNameRecord(valueRecord.ModelName)) {
    return valueRecord.ModelName
  }

  if (isModelNameRecord(valueRecord.Prisma?.ModelName)) {
    return valueRecord.Prisma.ModelName
  }

  if ('default' in valueRecord) {
    return getModelName(valueRecord.default)
  }

  return null
}

async function getPrismaClient(): Promise<{
  ModelName: Record<string, string>
}> {
  // Prefer a direct import of the generated client entry. This works for both
  // Prisma v6 (node_modules/.prisma) and v7 custom output paths.
  try {
    const localPrisma = await importGeneratedPrismaClient()
    const modelName = getModelName(localPrisma)
    if (modelName) {
      return { ModelName: modelName }
    }
  } catch {
    // If no generated client exists yet we fall back and then generate.
  }

  // Fallback for older setups that still rely on package resolution.
  try {
    const packagePrisma = await import('@prisma/client')
    const modelName = getModelName(packagePrisma)
    if (modelName) {
      return { ModelName: modelName }
    }
  } catch {
    // Ignore and generate a fresh client below.
  }

  execa.sync('yarn', ['cedar', 'prisma', 'generate'])

  try {
    const freshPrisma = await importGeneratedPrismaClient()
    const modelName = getModelName(freshPrisma)
    if (modelName) {
      return { ModelName: modelName }
    }
  } catch {
    // Fall through to empty ModelName object below.
  }

  return { ModelName: {} }
}

async function getPrismaModels() {
  // Extract the models from the prisma client and use those to
  // set up internal redirects for the return values in resolvers.
  const localPrisma = await getPrismaClient()
  const prismaModels = localPrisma.ModelName

  // This isn't really something you'd put in the GraphQL API, so
  // we can skip the model.
  if (prismaModels.RW_DataMigration) {
    delete prismaModels.RW_DataMigration
  }

  return prismaModels
}

async function getPluginConfig(side: CodegenSide) {
  const prismaModels: Record<string, string> = await getPrismaModels()
  Object.keys(prismaModels).forEach((key) => {
    /** creates an object like this
     * {
     *  Post: MergePrismaWithSdlTypes<PrismaPost, MakeRelationsOptional<Post, AllMappedModels>, AllMappedModels>>
     *  ...
     * }
     */
    prismaModels[key] =
      `MergePrismaWithSdlTypes<Prisma${key}, MakeRelationsOptional<${key}, AllMappedModels>, AllMappedModels>`
  })

  type ScalarKeys =
    | 'BigInt'
    | 'DateTime'
    | 'Date'
    | 'JSON'
    | 'JSONObject'
    | 'Time'
    | 'Byte'
    | 'File'
  const scalars: Partial<Record<ScalarKeys, string>> = {
    // We need these, otherwise these scalars are mapped to any
    BigInt: 'number',
    // @Note: DateTime fields can be valid Date-strings, or the Date object in the api side. They're always strings on the web side.
    DateTime: side === CodegenSide.WEB ? 'string' : 'Date | string',
    Date: side === CodegenSide.WEB ? 'string' : 'Date | string',
    JSON: 'Prisma.JsonValue',
    JSONObject: 'Prisma.JsonObject',
    Time: side === CodegenSide.WEB ? 'string' : 'Date | string',
    Byte: 'Uint8Array',
  }

  const config = getConfig()
  if (config.graphql.includeScalars.File) {
    scalars.File = 'File'
  }

  const pluginConfig: CodegenTypes.PluginConfig &
    rwTypescriptResolvers.TypeScriptResolversPluginConfig = {
    makeResolverTypeCallable: true,
    namingConvention: 'keep', // to allow camelCased query names
    scalars,
    // prevent type names being PetQueryQuery, RW generators already append
    // Query/Mutation/etc
    omitOperationSuffix: true,
    showUnusedMappers: false,
    customResolverFn: getResolverFnType(),
    mappers: prismaModels,
    avoidOptionals: {
      // We do this, so that service tests can call resolvers without doing a null check
      // see https://github.com/redwoodjs/redwood/pull/6222#issuecomment-1230156868
      // Look at type or source https://shrtm.nu/2BA0 for possible config, not well documented
      resolvers: true,
    },
    contextType: `@cedarjs/graphql-server/dist/types#CedarGraphQLContext`,
  }

  return pluginConfig
}

export const getResolverFnType = () => {
  const tsConfig = getTsConfigs()

  if (tsConfig.api?.compilerOptions?.strict) {
    // In strict mode, bring a world of pain to the tests
    return `(
      args: TArgs,
      obj?: { root: TParent; context: TContext; info: GraphQLResolveInfo }
    ) => TResult | Promise<TResult>`
  } else {
    return `(
      args?: TArgs,
      obj?: { root: TParent; context: TContext; info: GraphQLResolveInfo }
    ) => TResult | Promise<TResult>`
  }
}

interface CombinedPluginConfig {
  name: string
  options: CodegenTypes.PluginConfig
  codegenPlugin: CodegenPlugin
}

/**
 * Codgen plugin that just lists all the SDL models that are also mapped Prisma models
 * We use a plugin, because its possible to have Prisma models that do not have an SDL model
 * so we can't just list all the Prisma models, even if they're included in the mappers object.
 *
 * Example:
 * type AllMappedModels = MaybeOrArrayOfMaybe<Post | User>
 *
 * Note that the types are SDL types, not Prisma types.
 * We do not include SDL-only types in this list.
 */
const printMappedModelsPlugin: CodegenPlugin = {
  plugin: (schema, _documents, config) => {
    // this way we can make sure relation types are not required
    const sdlTypesWhichAreMapped = Object.values(schema.getTypeMap())
      .filter((type) => {
        return type.astNode?.kind === Kind.OBJECT_TYPE_DEFINITION
      })
      .filter((objectDefType) => {
        const modelName = objectDefType.astNode?.name.value
        return (
          modelName && modelName in config.mappers // Only keep the mapped Prisma models
        )
      })
      .map((objectDefType) => objectDefType.astNode?.name.value)

    return `type MaybeOrArrayOfMaybe<T> = T | Maybe<T> | Maybe<T>[];\ntype AllMappedModels = MaybeOrArrayOfMaybe<${sdlTypesWhichAreMapped.join(
      ' | ',
    )}>`
  },
}

function getCodegenOptions(
  documents: CodegenTypes.DocumentFile[],
  config: CodegenTypes.PluginConfig,
  extraPlugins: CombinedPluginConfig[],
) {
  const plugins = [
    { typescript: { enumsAsTypes: true } },
    ...extraPlugins.map((plugin) => ({ [plugin.name]: plugin.options })),
  ]

  const pluginMap = {
    typescript: typescriptPlugin,
    ...extraPlugins.reduce(
      (acc, cur) => ({ ...acc, [cur.name]: cur.codegenPlugin }),
      {},
    ),
  }

  const options: CodegenTypes.GenerateOptions = {
    // The typescript plugin returns a string instead of writing to a file, so
    // `filename` is not used
    filename: '',
    // `schemaAst` is used instead of `schema` if `schemaAst` is defined, and
    // `schema` isn't. In the source for GenerateOptions they have this
    // comment:
    //   Remove schemaAst and change schema to GraphQLSchema in the next major
    //   version
    // When that happens we'll have have to remove our `schema` line, and
    // rename `schemaAst` to `schema`
    schema: undefined as unknown as DocumentNode,
    schemaAst: loadSchemaSync(getPaths().generated.schema, {
      loaders: [new GraphQLFileLoader()],
      sort: true,
    }),
    documents,
    config,
    plugins,
    pluginMap,
    pluginContext: {},
  }

  return options
}
