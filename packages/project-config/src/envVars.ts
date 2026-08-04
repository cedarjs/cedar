interface ReadEnvVarOptions {
  /**
   * The pre-fork `REDWOOD_`-prefixed name for this env var. Still read, so
   * projects don't break on upgrade, but the `CEDAR_`-prefixed name wins.
   */
  deprecatedAlias: string
}

/**
 * Read an env var that was renamed when Cedar forked from Redwood.
 *
 * The `CEDAR_`-prefixed name wins. The `REDWOOD_`-prefixed one keeps working
 * so existing projects don't break on upgrade.
 *
 * Empty strings are treated as unset, matching how a `.env` file with a blank
 * value behaves.
 */
export function readEnvVar(
  name: string,
  { deprecatedAlias }: ReadEnvVarOptions,
): string | undefined {
  return process.env[name] || process.env[deprecatedAlias] || undefined
}

/**
 * Parse a port from an env var, rejecting anything that isn't a whole number.
 *
 * `parseInt` alone is not enough here: it stops at the first non-digit, so
 * `"8080abc"` would become `8080` and `"1.5"` would become `1`. Silently
 * binding a port the user didn't ask for is how a deployment ends up
 * unreachable, so the whole value has to look like an integer.
 */
export function parsePort(value: string, envVarName: string): number {
  const trimmed = value.trim()

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid ${envVarName} env var value: "${value}". Must be an integer.`,
    )
  }

  return Number(trimmed)
}
