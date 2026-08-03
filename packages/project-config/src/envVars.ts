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
