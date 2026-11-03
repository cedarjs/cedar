/**
 * Every permission an app checks, and what each role may do.
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
   * What each role may do: a role is a named bundle of permissions. A role
   * that isn't listed has no permissions.
   */
  roles: Readonly<Record<string, readonly Name[]>>
}

/** The permission names in `definitions` */
export type PermissionName<Definitions> =
  Definitions extends PermissionDefinitions<infer Name> ? Name : never

/**
 * Throws when a role lists a permission that `permissions` doesn't define.
 * The types catch this in TypeScript; this is for JavaScript, and for
 * definitions built at runtime.
 */
export function assertPermissionDefinitions(
  definitions: PermissionDefinitions,
) {
  const defined = new Set(definitions.permissions)
  for (const [role, names] of Object.entries(definitions.roles)) {
    for (const name of names) {
      if (!defined.has(name)) {
        throw new Error(
          `Unknown permission "${name}" in role "${role}". Add it to ` +
            '`permissions` in your permission definitions first.',
        )
      }
    }
  }
}

/**
 * Defines an app's permissions, and what each role may do. Permission names
 * are typed from `permissions`, so a role listing a name that isn't defined
 * is a type error.
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
}): PermissionDefinitions<Name> {
  assertPermissionDefinitions(definitions)

  return definitions
}

/** Whether `name` is one of the permissions `definitions` defines */
export function isPermission<Name extends string>(
  definitions: PermissionDefinitions<Name>,
  name: unknown,
): name is Name {
  return definitions.permissions.some((permission) => permission === name)
}

/**
 * Throws when `definitions` doesn't define `name`, so a typo (in an SDL
 * directive, say) is an error instead of a check that refuses everyone
 */
export function assertPermission<Name extends string>(
  definitions: PermissionDefinitions<Name>,
  name: string,
): asserts name is Name {
  if (!isPermission(definitions, name)) {
    throw new Error(
      `Unknown permission "${name}". Add it to \`permissions\` in your ` +
        'permission definitions before using it.',
    )
  }
}

/**
 * What `roles` may do: every permission any of them has. The one place a
 * role becomes permissions. A role the definitions don't list has none.
 */
export function permissionsOf<Name extends string>(
  definitions: PermissionDefinitions<Name>,
  roles: string | readonly string[] | null | undefined,
): Name[] {
  const list = typeof roles === 'string' ? [roles] : (roles ?? [])
  const permissions = new Set<Name>()

  for (const role of list) {
    // Own properties only, so a role named `toString` has nothing
    if (Object.hasOwn(definitions.roles, role)) {
      for (const permission of definitions.roles[role]) {
        permissions.add(permission)
      }
    }
  }

  return [...permissions]
}

/**
 * Whether `held` covers `role`: it has every permission `role` has. This is
 * who may give someone a role, so no one can hand out more than they may do
 * themselves. False for a role the definitions don't list.
 */
export function coversRole<Name extends string>(
  definitions: PermissionDefinitions<Name>,
  held: readonly string[],
  role: string,
): boolean {
  if (!Object.hasOwn(definitions.roles, role)) {
    return false
  }

  return definitions.roles[role].every((permission) =>
    held.includes(permission),
  )
}
