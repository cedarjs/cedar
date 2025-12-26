import { Listr } from 'listr2'
import pascalcase from 'pascalcase'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { pluralize } from '../../../lib/cedarPluralize.js'
import c from '../../../lib/colors.js'
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

const removeRoutesWithSet = async ({ model, path, nestScaffoldByModel }) => {
  const routes = await scaffoldRoutes({ model, path, nestScaffoldByModel })
  const routeNames = routes.map(extractRouteName)
  const pluralPascalName = pascalcase(pluralize(model))
  const layoutName = `${pluralPascalName}Layout`
  return removeRoutesFromRouterTask(routeNames, layoutName)
}

const removeSetImport = () => {
  const routesPath = getPaths().web.routes
  const routesContent = readFile(routesPath).toString()
  if (routesContent.match('<Set')) {
    return 'Skipping removal of Set import in Routes.{jsx,tsx}'
  }

  const [redwoodRouterImport] = routesContent.match(
    /import {[^]*} from '@cedarjs\/router'/,
  )
  const removedSetImport = redwoodRouterImport.replace(/,*\s*Set,*/, '')
  const newRoutesContent = routesContent.replace(
    redwoodRouterImport,
    removedSetImport,
  )
  writeFile(routesPath, newRoutesContent, { overwriteExisting: true })

  return 'Removed Set import in Routes.{jsx,tsx}'
}

const removeLayoutImport = ({ model: name, path: scaffoldPath = '' }) => {
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

export const tasks = ({ model, path, tests, nestScaffoldByModel }) =>
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

export const handler = async ({ model: modelArg }) => {
  recordTelemetryAttributes({
    command: 'destory scaffold',
  })
  const { model, path } = splitPathAndModel(modelArg)
  try {
    const { name } = await verifyModelName({ name: model, isDestroyer: true })
    await tasks({ model: name, path }).run()
  } catch (e) {
    console.log(c.error(e.message))
  }
}

const extractRouteName = (route) => {
  const { groups } = route.match(/.*name="?(?<routeName>\w+)"?/)
  return groups.routeName
}
