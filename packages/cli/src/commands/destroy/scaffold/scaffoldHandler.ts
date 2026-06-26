import { Listr } from 'listr2'
import pascalcase from 'pascalcase'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { pluralize } from '@cedarjs/utils/cedarPluralize'

import {
  deleteFilesTask,
  getPaths,
  readFile,
  removeRoutesFromRouterTask,
  writeFile,
} from '../../../lib/index.js'
import { verifyModelName } from '../../../lib/schemaHelpers.js'
import {
  files,
  routes as scaffoldRoutes,
  splitPathAndModel,
} from '../../generate/scaffold/scaffoldHandler.js'

interface ScaffoldTaskArgs {
  model: string
  path?: string
  tests?: boolean
  nestScaffoldByModel?: boolean
}

const removeRoutesWithSet = async ({
  model,
  path,
  nestScaffoldByModel,
}: ScaffoldTaskArgs): Promise<
  ReturnType<typeof removeRoutesFromRouterTask>
> => {
  const routes = await scaffoldRoutes({ model, path, nestScaffoldByModel })
  const routeNames = routes.map(extractRouteName)
  const pluralPascalName = pascalcase(pluralize(model))
  const layoutName = `${pluralPascalName}Layout`
  return removeRoutesFromRouterTask(routeNames, layoutName)
}

const removeSetImport = (): string => {
  const routesPath = getPaths().web.routes
  const routesContent = readFile(routesPath).toString()
  if (routesContent.match('<Set')) {
    return 'Skipping removal of Set import in Routes.{jsx,tsx}'
  }

  const cedarRouterImportMatch = routesContent.match(
    /import {[^]*} from '@cedarjs\/router'/,
  )
  if (!cedarRouterImportMatch) {
    return 'No @cedarjs/router import found in Routes.{jsx,tsx}'
  }
  const [cedarRouterImport] = cedarRouterImportMatch
  const removedSetImport = cedarRouterImport.replace(/,*\s*Set,*/, '')
  const newRoutesContent = routesContent.replace(
    cedarRouterImport,
    removedSetImport,
  )
  writeFile(routesPath, newRoutesContent, { overwriteExisting: true })

  return 'Removed Set import in Routes.{jsx,tsx}'
}

const removeLayoutImport = ({
  model: name,
  path: scaffoldPath = '',
}: {
  model: string
  path?: string
}): string => {
  const pluralPascalName = pascalcase(pluralize(name))
  const pascalScaffoldPath =
    scaffoldPath === ''
      ? scaffoldPath
      : scaffoldPath.split('/').map(pascalcase).join('/') + '/'
  const layoutName = `${pluralPascalName}Layout`
  const importLayout = `import ${pluralPascalName}Layout from 'src/layouts/${pascalScaffoldPath}${layoutName}'`
  const routesPath = getPaths().web.routes
  const routesContent = readFile(routesPath).toString()

  const newRoutesContent = routesContent.replace(
    new RegExp(`\\s*${importLayout}`),
    '',
  )

  writeFile(routesPath, newRoutesContent, { overwriteExisting: true })

  return 'Removed layout import from Routes.{jsx,tsx}'
}

export const tasks = ({
  model,
  path,
  tests,
  nestScaffoldByModel,
}: ScaffoldTaskArgs) =>
  new Listr(
    [
      {
        title: 'Destroying scaffold files...',
        task: async () => {
          const f = await files({
            model,
            path,
            tests,
            nestScaffoldByModel,
          })

          return deleteFilesTask(f)
        },
      },
      {
        title: 'Cleaning up scaffold routes...',
        task: async () =>
          removeRoutesWithSet({ model, path, nestScaffoldByModel }),
      },
      {
        title: 'Removing set import...',
        task: () => removeSetImport(),
      },
      {
        title: 'Removing layout import...',
        task: () => removeLayoutImport({ model, path }),
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export const handler = async ({ model: modelArg }: { model: string }) => {
  recordTelemetryAttributes({
    command: 'destory scaffold',
  })
  const { model, path } = splitPathAndModel(modelArg)
  try {
    const { name } = await verifyModelName({ name: model, isDestroyer: true })
    await tasks({ model: name, path }).run()
  } catch (e) {
    console.log(c.error(e instanceof Error ? e.message : String(e)))
  }
}

const extractRouteName = (route: string): string => {
  const match = route.match(/.*name="?(?<routeName>\w+)"?/)
  if (!match?.groups?.routeName) {
    throw new Error(`Could not extract route name from route: ${route}`)
  }
  return match.groups.routeName
}
