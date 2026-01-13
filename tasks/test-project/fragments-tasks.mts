import fs from 'node:fs'
import path from 'node:path'

import {
  createBuilder,
  fullPath,
  getOutputPath,
  setOutputPath,
  addModel,
} from './base-tasks.mts'
import { getExecaOptions, applyCodemod, exec } from './util.mts'

/**
 * Tasks to add GraphQL Fragments support to the test-project, and some queries
 * to test those fragments
 */
export function fragmentsTasks(outputPath: string) {
  setOutputPath(outputPath)

  const taskList = [
    {
      title: 'Enable fragments',
      task: async () => {
        const redwoodTomlPath = path.join(outputPath, 'redwood.toml')
        const redwoodToml = fs.readFileSync(redwoodTomlPath).toString()
        const newRedwoodToml = redwoodToml + '\n[graphql]\n  fragments = true\n'
        fs.writeFileSync(redwoodTomlPath, newRedwoodToml)
      },
    },
    {
      title: 'Adding produce and stall models to prisma',
      task: async () => {
        // Need both here since they have a relation
        const { produce, stall } = await import('./codemods/models.mts')

        addModel(produce)
        addModel(stall)

        return exec(
          'yarn cedar prisma migrate dev --name create_produce_stall',
          [],
          getExecaOptions(outputPath),
        )
      },
    },
    {
      title: 'Seed fragments data',
      task: async () => {
        await applyCodemod(
          'seedFragments.ts',
          fullPath('scripts/seed.ts', { addExtension: false }),
        )

        await exec('yarn cedar prisma db seed', [], getExecaOptions(outputPath))
      },
    },
    {
      title: 'Generate SDLs for produce and stall',
      task: async () => {
        const generateSdl = createBuilder('yarn cedar g sdl')

        await generateSdl('stall')
        await generateSdl('produce')

        await applyCodemod(
          'producesSdl.ts',
          fullPath('api/src/graphql/produces.sdl'),
        )
      },
    },
    {
      title: 'Copy components from templates',
      task: () => {
        const templatesPath = path.join(import.meta.dirname, 'templates', 'web')
        const componentsPath = path.join(
          getOutputPath(),
          'web',
          'src',
          'components',
        )

        for (const fileName of [
          'Card.tsx',
          'FruitInfo.tsx',
          'ProduceInfo.tsx',
          'StallInfo.tsx',
          'VegetableInfo.tsx',
        ]) {
          const templatePath = path.join(templatesPath, fileName)
          const componentPath = path.join(componentsPath, fileName)

          fs.writeFileSync(componentPath, fs.readFileSync(templatePath))
        }
      },
    },
    {
      title: 'Copy sdl and service for groceries from templates',
      task: () => {
        const templatesPath = path.join(import.meta.dirname, 'templates', 'api')
        const graphqlPath = path.join(getOutputPath(), 'api', 'src', 'graphql')
        const servicesPath = path.join(
          getOutputPath(),
          'api',
          'src',
          'services',
        )

        const sdlTemplatePath = path.join(templatesPath, 'groceries.sdl.ts')
        const sdlPath = path.join(graphqlPath, 'groceries.sdl.ts')
        const serviceTemplatePath = path.join(templatesPath, 'groceries.ts')
        const servicePath = path.join(servicesPath, 'groceries.ts')

        fs.writeFileSync(sdlPath, fs.readFileSync(sdlTemplatePath))
        fs.writeFileSync(servicePath, fs.readFileSync(serviceTemplatePath))
      },
    },
    {
      title: 'Creating Groceries page',
      task: async () => {
        const createPage = createBuilder('yarn cedar g page')
        await createPage('groceries')

        await applyCodemod(
          'groceriesPage.ts',
          fullPath('web/src/pages/GroceriesPage/GroceriesPage'),
        )
      },
    },
  ]

  return taskList
}
