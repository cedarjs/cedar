import { $ } from 'zx'

interface Problem {
  kind: string
  entrypoint?: string
  resolutionKind?: string
}

// Excluded entry points:
// - ./bins/cedar-vite-build.mjs: this is only used in the build handler
// - ./react-node-loader: used to run the Worker

await $({
  nothrow: true,
})`yarn attw -P --exclude-entrypoints ./bins/cedar-vite-build.mjs -f json > .attw.json`
const output = await $`cat .attw.json`
await $`rm .attw.json`

const json = JSON.parse(output.stdout)

// If no errors were found then return early
if (!json.analysis.problems || json.analysis.problems.length === 0) {
  console.log('No errors found')
  process.exit(0)
}

// We don't care about node10 errors, and since we require at least Node.js
// 22.19.0, we also ignore require(esm) warnings
// https://github.com/arethetypeswrong/arethetypeswrong.github.io/issues/252
const problems: Problem[] = json.analysis.problems.filter(
  (problem: Problem) =>
    problem.resolutionKind !== 'node10' && problem.kind !== 'CJSResolvesToESM',
)

// If no errors were found after filtering, return 0
if (problems.length === 0) {
  console.log('No errors found')
  process.exit(0)
}

console.log('Errors found')
console.log(problems)
process.exit(1)
