import fs from 'node:fs'
import path from 'node:path'

import { getDMMF } from '@prisma/internals'

import {
  getPaths,
  getPackageManager,
  runPackageManagerCommand,
  runScript,
} from '@cedarjs/cli-helpers'
import {
  processPagesDir,
  getSchemaPath,
  getPrismaSchemas,
} from '@cedarjs/project-config'

export const libPath = getPaths().api.lib.replace(getPaths().base, '')
export const functionsPath = getPaths().api.functions.replace(
  getPaths().base,
  '',
)

export const getModelNames = async () => {
  const result = await getPrismaSchemas()
  const datamodel = result.schemas
  const schema = await getDMMF({ datamodel })

  return schema.datamodel.models.map((model) => model.name)
}

export const hasModel = async (name: string) => {
  if (!name) {
    return false
  }

  // Support PascalCase, camelCase, kebab-case, UPPER_CASE, and lowercase model
  // names
  const modelName = name.replace(/[_-]/g, '').toLowerCase()
  const modelNames = (await getModelNames()).map((name) => name.toLowerCase())

  if (modelNames.includes(modelName)) {
    return true
  }

  return false
}

export async function addModels(models: string) {
  const schemaPath = await getSchemaPath(getPaths().api.prismaConfig)
  const isDirectory = fs.statSync(schemaPath).isDirectory()

  if (isDirectory) {
    fs.writeFileSync(path.join(schemaPath, 'user.prisma'), models)
  } else {
    fs.appendFileSync(schemaPath, models)
  }
}

export function hasAuthPages() {
  const routes = fs.readFileSync(getPaths().web.routes, 'utf-8')

  // If the user already has a route for /login, /signin, or /signup, we
  // assume auth pages are already set up
  if (/path={?['"]\/(login|signin|signup)['"]}? /i.test(routes)) {
    return true
  }

  return processPagesDir().some((page) => {
    if (
      page.importName === 'LoginPage' ||
      page.importName === 'LogInPage' ||
      page.importName === 'SigninPage' ||
      page.importName === 'SignInPage' ||
      page.importName === 'SignupPage' ||
      page.importName === 'SignUpPage'
    ) {
      return true
    }

    return false
  })
}

export function generateAuthPagesTask(generatingUserModel: boolean) {
  return {
    title: 'Adding dbAuth pages...',
    task: async () => {
      const rwjsPaths = getPaths()

      const cedarArgs = ['g', 'dbAuth']

      if (generatingUserModel) {
        cedarArgs.push(
          '--username-label',
          'username',
          '--password-label',
          'password',
        )
      }

      const pm = getPackageManager()
      await runPackageManagerCommand(runScript('cedar', pm, cedarArgs), {
        stdio: 'inherit',
        cwd: rwjsPaths.base,
      })
    },
  }
}
