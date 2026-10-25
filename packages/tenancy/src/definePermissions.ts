/**
 * Every permission an app checks, and what the built-in roles may do.
 *
 * Plain data with no api code in it, so both sides can import it: the api to
 * check permissions (`createPermissions`), and the web for the names.
 */
export interface PermissionDefinitions<Name extends string = string> {
  /**
   * Every permission the app checks, by name. Fields, services and the web
   * ask for these names, so they're defined in code. A name is a stable id,
   * so it can also key what an app shows for it, such as translations.
   */
  permissions: readonly Name[]
  /**
   * What each built-in role may do in an organization. A role that isn't
   * listed has no permissions.
   */
  roles: Readonly<Record<string, readonly Name[]>>
  /**
   * What every signed-in user may do, in any organization or none: things
   * about their own account. No organization is needed for these.
   */
  user?: readonly Name[]
}

/** The permission names in `definitions` */
export type PermissionName<Definitions> =
  Definitions extends PermissionDefinitions<infer Name> ? Name : never

/**
 * Throws when a role or `user` lists a permission that `permissions`
 * doesn't define. The types catch this in TypeScript; this is for
 * JavaScript, and for definitions built at runtime.
 */
export function assertPermissionDefinitions(
  definitions: PermissionDefinitions,
) {
  const defined = new Set(definitions.permissions)
  const listed = [
    ...Object.entries(definitions.roles).map(
      ([role, names]) => [`role "${role}"`, names] as const,
    ),
    ['user', definitions.user ?? []] as const,
  ]

  for (const [where, names] of listed) {
    for (const name of names) {
      if (!defined.has(name)) {
        throw new Error(
          `Unknown permission "${name}" in ${where}. Add it to ` +
            '`permissions` in your permission definitions first.',
        )
      }
    }
  }
}

/**
 * Defines an app's permissions, and what each built-in role may do.
 * Permission names are typed from `permissions`, so a role listing a name
 * that isn't defined is a type error.
 *
 * ```ts
 * export const permissions = definePermissions({
 *   permissions: ['projects.read', 'members.manage'],
 *   roles: {
 *     owner: ['projects.read', 'members.manage'],
 *     member: ['projects.read'],
 *   },
 * })
 * ```
 *
 * Pass the result to `createPermissions` on the api.
 */
export function definePermissions<const Name extends string>(definitions: {
  permissions: readonly Name[]
  roles: Readonly<Record<string, readonly NoInfer<Name>[]>>
  user?: readonly NoInfer<Name>[]
}): PermissionDefinitions<Name> {
  assertPermissionDefinitions(definitions)

  return definitions
}
