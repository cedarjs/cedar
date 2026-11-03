const KNOWN_WORKSPACES = new Set(['api', 'web', 'packages/*'])

/**
 * Serializes a list of workspaces for telemetry.
 *
 * `api`, `web` and `packages/*` are kept as-is. Any other value is a package
 * name or path chosen by the user (like `@acme/payroll-utils`), so it is
 * recorded as `package` to only keep the fact that a single package was
 * targeted.
 */
export function workspacesForTelemetry(workspaces: string[]) {
  return JSON.stringify(
    workspaces.map((workspace) =>
      KNOWN_WORKSPACES.has(workspace) ? workspace : 'package',
    ),
  )
}
