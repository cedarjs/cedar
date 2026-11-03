// Checks that the type definitions Cedar generates in `.cedar/types` work in a
// project, whichever package manager installed it.
//
// Two things can go wrong, and the second one is silent:
//
// 1. A package imported by a generated file can't be resolved (TS2307). pnpm
//    only links hoisted packages into the root `node_modules`, which is where
//    TypeScript looks for imports in `.cedar/types`.
// 2. A `declare module` augmentation of a package that can't be resolved is
//    dropped without an error, so the augmented types go missing or become
//    `any`. The assertions below fail in that case.
//
// Usage: node check-generated-types.mts <project-path> [yarn|npm|pnpm]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { PackageManager } from '@cedarjs/project-config/packageManager'

const projectPath = path.resolve(process.argv[2] ?? '')
const packageManager = (process.argv[3] ?? 'yarn') as PackageManager

if (!process.argv[2] || !fs.existsSync(projectPath)) {
  console.error('Usage: check-generated-types.mts <project-path> [pm]')
  process.exit(1)
}

const tscCommand: Record<PackageManager, string[]> = {
  yarn: ['yarn', 'tsc'],
  npm: ['npx', 'tsc'],
  pnpm: ['pnpm', 'exec', 'tsc'],
}

const cedarCommand: Record<PackageManager, string[]> = {
  yarn: ['yarn', 'cedar'],
  npm: ['npx', 'cedar'],
  pnpm: ['pnpm', 'exec', 'cedar'],
}

const assertionsFile = '__generated-types-check.ts'

const isAny = 'type IsAny<T> = 0 extends 1 & T ? true : false\n'

// Whether the api side depends on `@cedarjs/realtime`. Cedar then generates the
// full type of the GraphQL handler's `realtime` option, which is otherwise
// `MinimalRealtimeOptions`
function apiUsesRealtime() {
  const apiPackageJson = JSON.parse(
    fs.readFileSync(path.join(projectPath, 'api', 'package.json'), 'utf8'),
  )

  return Boolean(
    apiPackageJson.dependencies?.['@cedarjs/realtime'] ||
    apiPackageJson.devDependencies?.['@cedarjs/realtime'],
  )
}

// What each side's generated types have to provide. Each assertion fails to
// compile if its type is missing, and the `IsAny` ones fail if it is `any`
function getAssertions(side: 'api' | 'web') {
  if (side === 'web') {
    return [
      "import type { AvailableRoutes } from '@cedarjs/router'",
      '',
      'export const routesAreTyped: keyof AvailableRoutes extends never',
      '  ? never',
      '  : true = true',
    ]
  }

  const realtimeType = apiUsesRealtime()
    ? 'CedarRealtimeOptions'
    : 'MinimalRealtimeOptions'
  const realtimeImport = apiUsesRealtime()
    ? "import type { CedarRealtimeOptions } from '@cedarjs/realtime'"
    : "import type { MinimalRealtimeOptions } from '@cedarjs/graphql-server'"

  return [
    "import type { createGraphQLHandler } from '@cedarjs/graphql-server'",
    realtimeImport,
    '',
    isAny,
    'type RealtimeOption = NonNullable<',
    "  Parameters<typeof createGraphQLHandler>[0]['realtime']",
    '>',
    '',
    'export const contextIsTyped: IsAny<typeof context> extends false',
    '  ? true',
    '  : never = true',
    'export const currentUserIsTyped: IsAny<typeof context.currentUser> extends false',
    '  ? true',
    '  : never = true',
    'export const realtimeOptionIsNotAny: IsAny<RealtimeOption> extends false',
    '  ? true',
    '  : never = true',
    `export const realtimeOptionIsTyped: [RealtimeOption] extends [${realtimeType}]`,
    `  ? [${realtimeType}] extends [RealtimeOption]`,
    '    ? true',
    '    : never',
    '  : never = true',
  ]
}

const errorPattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

// The type definitions are written by `cedar g types`
const [cedarBin, ...cedarArgs] = cedarCommand[packageManager]
const generate = spawnSync(cedarBin, [...cedarArgs, 'g', 'types'], {
  cwd: projectPath,
  encoding: 'utf8',
})

if (generate.status !== 0) {
  console.error('✖ `cedar g types` failed')
  console.error(generate.stdout + generate.stderr)
  process.exit(1)
}

let failed = false

for (const side of ['api', 'web'] as const) {
  const sidePath = path.join(projectPath, side)
  const assertionsPath = path.join(sidePath, 'src', assertionsFile)

  fs.writeFileSync(assertionsPath, getAssertions(side).join('\n') + '\n')

  let output: string

  try {
    const [command, ...args] = tscCommand[packageManager]
    // Run from the side's directory, like `cedar type-check` does, because
    // that's where the package manager can find `tsc`. Not through `cedar
    // type-check`, which passes --skipLibCheck and so hides errors in the
    // generated .d.ts files
    const result = spawnSync(command, [...args, '--noEmit'], {
      cwd: sidePath,
      encoding: 'utf8',
    })

    if (result.error) {
      throw result.error
    }

    // tsc exits with 0 when there are no errors and 2 when it reported some.
    // Anything else means it didn't run, which must not read as a pass
    if (result.status !== 0 && result.status !== 2) {
      throw new Error(
        `${side}: tsc failed to run\n${result.stdout}${result.stderr}`,
      )
    }

    output = result.stdout + result.stderr
  } finally {
    fs.rmSync(assertionsPath, { force: true })
  }

  const errors = output
    .split('\n')
    .map((line) => errorPattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([line, file, , , code]) => ({ line, file, code }))

  const unresolved = errors.filter(
    ({ file, code }) => file.includes('.cedar/types/') && code === 'TS2307',
  )
  const wrongTypes = errors.filter(({ file }) => file.endsWith(assertionsFile))

  if (unresolved.length === 0 && wrongTypes.length === 0) {
    console.log(`✔ ${side}: generated types resolve and have their types`)
    continue
  }

  failed = true
  console.error(`✖ ${side}: generated types are broken`)

  for (const { line } of [...unresolved, ...wrongTypes]) {
    console.error(`  ${line}`)
  }
}

process.exit(failed ? 1 : 0)
