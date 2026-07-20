import path from 'node:path'

import { generate } from '@graphql-codegen/cli'
import type { CodegenConfig } from '@graphql-codegen/cli'
import { addTypenameSelectionDocumentTransform } from '@graphql-codegen/client-preset'

import { getConfig, getPaths } from '@cedarjs/project-config'

import {
  trustedDocumentsStore,
  replaceGqlTagWithTrustedDocumentGraphql,
} from './trustedDocuments.js'
import type { GeneratedFile } from './types.js'

export const shouldGenerateTrustedDocuments = (): boolean => {
  const config = getConfig()

  return config.graphql.trustedDocuments
}

export const generateClientPreset = async () => {
  let clientPresetFiles = [] as string[]

  const errors: { message: string; error: unknown }[] = []

  if (!shouldGenerateTrustedDocuments()) {
    return { clientPresetFiles, trustedDocumentsStoreFile: [], errors }
  }

  // The documents glob and the generates path have to be relative (resolved
  // against `cwd` below). With absolute paths, projects located in a path
  // that contains a space would break, because @graphql-tools/load treats any
  // unparseable pointer that contains a space as an inline GraphQL document
  // and throws
  const documentsGlob = './web/src/**/!(*.d).{ts,tsx,js,jsx}'

  const config: CodegenConfig = {
    cwd: getPaths().base,
    schema: getPaths().generated.schema,
    documents: documentsGlob,
    silent: true, // Plays nicely with cli task output
    generates: {
      ['./web/src/graphql/']: {
        preset: 'client',
        presetConfig: {
          persistedDocuments: true,
        },
        documentTransforms: [addTypenameSelectionDocumentTransform],
        config: {
          // DO NOT USE documentMode: 'string',
        },
      },
    },
  }

  try {
    // The codegen returns filenames relative to `cwd`, but everything
    // downstream (and our callers) expects absolute paths
    const generatedFiles = (await generate(config, true)).map(
      (f: GeneratedFile) => ({
        ...f,
        filename: path.resolve(getPaths().base, f.filename),
      }),
    )

    clientPresetFiles = generatedFiles.map((f: GeneratedFile) => f.filename)

    const trustedDocumentsStoreFile =
      await trustedDocumentsStore(generatedFiles)
    replaceGqlTagWithTrustedDocumentGraphql(generatedFiles)

    return {
      clientPresetFiles,
      trustedDocumentsStoreFile,
      errors,
    }
  } catch (e) {
    errors.push({
      message: 'Error: Could not generate GraphQL client preset',
      error: e,
    })

    return {
      clientPresetFiles,
      trustedDocumentsStoreFile: [],
      errors,
    }
  }
}
