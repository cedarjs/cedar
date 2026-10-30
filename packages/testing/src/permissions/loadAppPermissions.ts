import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PermissionDefinitions } from '@cedarjs/permissions'
import { getPaths } from '@cedarjs/project-config'

function readPackageJson(file: string): Record<string, unknown> | undefined {
  try {
    const packageJson: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))

    return packageJson && typeof packageJson === 'object'
      ? { ...packageJson }
      : undefined
  } catch {
    return undefined
  }
}

function dependsOn(packageJson: Record<string, unknown>, name: string) {
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = packageJson[field]

    return !!deps && typeof deps === 'object' && Object.hasOwn(deps, name)
  })
}

function isPermissionDefinitions(
  value: unknown,
): value is PermissionDefinitions {
  return (
    !!value &&
    typeof value === 'object' &&
    'permissions' in value &&
    Array.isArray(value.permissions) &&
    'roles' in value &&
    !!value.roles &&
    typeof value.roles === 'object'
  )
}

/**
 * The `permissions` that the app's permissions package (`packages/permissions`,
 * from `cedar setup permissions`) exports, as `sideBase` (the api or web
 * side) imports it. `undefined` in an app without one, and in an app with
 * tenancy, where permissions belong to a membership instead of the user.
 */
export async function loadAppPermissions(
  sideBase: string,
): Promise<PermissionDefinitions | undefined> {
  const sidePackageJsonPath = path.join(sideBase, 'package.json')
  const sidePackageJson = readPackageJson(sidePackageJsonPath)
  const packageJson = readPackageJson(
    path.join(getPaths().packages, 'permissions', 'package.json'),
  )
  const name = packageJson?.name

  if (
    !sidePackageJson ||
    typeof name !== 'string' ||
    !dependsOn(sidePackageJson, name) ||
    dependsOn(sidePackageJson, '@cedarjs/tenancy')
  ) {
    return undefined
  }

  let entry: string

  try {
    entry = createRequire(sidePackageJsonPath).resolve(name)
  } catch {
    console.warn(
      `Couldn't find ${name}, so mockCurrentUser() gives users no ` +
        'permissions. Build it with `yarn cedar build`.',
    )
    return undefined
  }

  const permissionsModule: unknown = await import(pathToFileURL(entry).href)

  if (
    permissionsModule &&
    typeof permissionsModule === 'object' &&
    'permissions' in permissionsModule &&
    isPermissionDefinitions(permissionsModule.permissions)
  ) {
    return permissionsModule.permissions
  }

  return undefined
}
