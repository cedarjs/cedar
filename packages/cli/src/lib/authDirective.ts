import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './index.js'

/**
 * Whether `cedar setup tenancy` has replaced the app's `@requireAuth` with
 * `@requireOrgAuth` and `@requireUserAuth`
 */
export function hasTenancyAuthDirectives() {
  return fs.existsSync(path.join(getPaths().api.directives, 'requireOrgAuth'))
}

/**
 * Whether a Prisma model's rows belong to an organization: it has the
 * `organizationId` that `cedar setup tenancy` asks for, or a relation to
 * `Organization`
 */
export function belongsToOrganization(model: {
  fields: readonly { name: string; type: string }[]
}) {
  return model.fields.some(
    (field) => field.name === 'organizationId' || field.type === 'Organization',
  )
}

/**
 * Generated `source` with its `@requireAuth` directives switched to the
 * ones an app with tenancy has: `@requireOrgAuth` when the data belongs to
 * an organization, `@requireUserAuth` when it doesn't. Unchanged in an app
 * without tenancy.
 */
export function withAuthDirective(
  source: string,
  { belongsToOrg }: { belongsToOrg: boolean },
) {
  if (!hasTenancyAuthDirectives()) {
    return source
  }

  return source.replace(
    /@requireAuth(?![\w$])/g,
    belongsToOrg ? '@requireOrgAuth' : '@requireUserAuth',
  )
}
