#!/usr/bin/env node

import { loadEnvFiles } from '@cedarjs/cli-helpers/loadEnvFiles'
import { getConfig, getPaths } from '@cedarjs/project-config'

import { generateClientPreset } from './clientPreset.js'
import { generateGqlormArtifacts } from './gqlormSchema.js'
import { generateGraphQLSchema } from './graphqlSchema.js'
import { generatePossibleTypes } from './possibleTypes.js'
import { generateTypeDefs } from './typeDefinitions.js'

export const generate = async () => {
  const config = getConfig()
  const { schemaPath, errors: generateGraphQLSchemaErrors } =
    await generateGraphQLSchema()
  const { typeDefFiles, errors: generateTypeDefsErrors } =
    await generateTypeDefs()

  const clientPresetFiles = []

  const { possibleTypesFiles, errors: generatePossibleTypesErrors } =
    await generatePossibleTypes()

  const { files: gqlormFiles, errors: gqlormErrors } =
    await generateGqlormArtifacts()

  if (config.graphql.trustedDocuments) {
    const preset = await generateClientPreset()
    clientPresetFiles.push(...preset.clientPresetFiles)
  }

  let files = []

  if (schemaPath !== '') {
    files.push(schemaPath)
  }

  files = [
    ...files,
    ...typeDefFiles,
    ...clientPresetFiles,
    ...possibleTypesFiles,
    ...gqlormFiles,
  ].filter((x) => typeof x === 'string')

  return {
    files,
    errors: [
      ...generateGraphQLSchemaErrors,
      ...generateTypeDefsErrors,
      ...generatePossibleTypesErrors,
      ...gqlormErrors,
    ],
  }
}

export const run = async () => {
  // Load .env, .env.defaults, and .env.{NODE_ENV} before doing anything else.
  // This mirrors what the Cedar CLI does in packages/cli/src/index.js and
  // ensures that env vars like DATABASE_URL (which live in .env.defaults in
  // freshly-created projects) are available when getPrismaSchemas() loads the
  // Prisma config. Without this, rw-gen bypasses the CLI bootstrap and
  // prisma.config.cjs throws PrismaConfigEnvError for unresolved variables.
  loadEnvFiles()

  console.log('Generating...')
  console.log()

  const { files, errors } = await generate()
  const rwjsPaths = getPaths()

  for (const f of files) {
    console.log('-', f.replace(rwjsPaths.base + '/', ''))
  }
  console.log()

  if (errors.length === 0) {
    console.log('... done.')
    console.log()
    return
  }
  process.exitCode ||= 1

  console.log('... done with errors.')
  console.log()

  for (const { message, error } of errors) {
    console.error(message)
    console.log()
    console.error(error)
    console.log()
  }
}

// Check if this file is being run directly
if (
  process.env.NODE_ENV !== 'test' &&
  process.argv[1]?.endsWith('generate.js')
) {
  run()
}
