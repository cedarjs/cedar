import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './index.js'

/**
 * Whether the app has tenancy: `cedar setup tenancy` adds `@cedarjs/tenancy`
 * to the api side, together with the `@requirePermission` directive
 */
export function hasTenancy() {
  let packageJson: {
    dependencies?: Record<string, unknown>
    devDependencies?: Record<string, unknown>
  }

  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(getPaths().api.base, 'package.json'), 'utf-8'),
    )
  } catch {
    return false
  }

  return (
    !!packageJson.dependencies?.['@cedarjs/tenancy'] ||
    !!packageJson.devDependencies?.['@cedarjs/tenancy']
  )
}

/**
 * The permission `cedar setup tenancy` gives every role, which generated
 * fields on an organization's data ask for: any member may use them
 */
export const MEMBER_PERMISSION = 'organization.read'

/**
 * The column tenant-owned models are scoped by: the `tenantField` given to
 * `createTenancyExtension` in `api/src/lib/db` (`setup tenancy
 * --tenant-field`), else `organizationId`
 */
export function tenantField() {
  for (const ext of ['ts', 'js']) {
    const dbPath = path.join(getPaths().api.lib, `db.${ext}`)

    if (fs.existsSync(dbPath)) {
      const match = fs
        .readFileSync(dbPath, 'utf-8')
        .match(/\btenantField:\s*['"](\w+)['"]/)

      return match?.[1] ?? 'organizationId'
    }
  }

  return 'organizationId'
}

/**
 * Whether a Prisma model's rows belong to an organization: it has the
 * tenant field `cedar setup tenancy` asks for (`organizationId`, unless
 * the app chose another), or a relation to `Organization`
 */
export function belongsToOrganization(model: {
  fields: readonly { name: string; type: string }[]
}) {
  const field = tenantField()

  return model.fields.some(
    ({ name, type }) => name === field || type === 'Organization',
  )
}

/**
 * Generated `source` with its `@requireAuth` directives switched to
 * `@requirePermission` with `MEMBER_PERMISSION` when the data belongs to an
 * organization in an app with tenancy. Unchanged otherwise: `@requireAuth`
 * is for data about the signed-in user.
 */
export function withAuthDirective(
  source: string,
  { belongsToOrg }: { belongsToOrg: boolean },
) {
  if (!belongsToOrg || !hasTenancy()) {
    return source
  }

  return source.replace(
    /@requireAuth(?![\w$])/g,
    `@requirePermission(permission: "${MEMBER_PERMISSION}")`,
  )
}
