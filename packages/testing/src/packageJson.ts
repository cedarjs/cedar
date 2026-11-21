import fs from 'node:fs'

/**
 * The parsed contents of the `package.json` at `file`, or `undefined` when
 * the file is missing or isn't a JSON object.
 */
export function readPackageJson(
  file: string,
): Record<string, unknown> | undefined {
  try {
    const packageJson: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))

    return packageJson && typeof packageJson === 'object'
      ? { ...packageJson }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether `packageJson` lists `name` in its `dependencies` or
 * `devDependencies`.
 */
export function dependsOn(packageJson: Record<string, unknown>, name: string) {
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = packageJson[field]

    return !!deps && typeof deps === 'object' && Object.hasOwn(deps, name)
  })
}
