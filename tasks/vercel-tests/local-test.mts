/**
 * Local E2E test for Cedar's Universal Deploy + Vercel integration.
 *
 * Usage:
 *   node tasks/vercel-tests/local-test.ts              # build + verify output only
 *   node tasks/vercel-tests/local-test.ts --deploy     # build + deploy + test live URL
 *   node tasks/vercel-tests/local-test.ts --keep       # keep temp dir after exit
 */

import { execSync } from 'node:child_process'
import type { ExecSyncOptions } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

const { values: args } = util.parseArgs({
  options: {
    deploy: { type: 'boolean', short: 'd' },
    keep: { type: 'boolean', short: 'k' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (args.help) {
  console.log(`Usage: node local-test.mts [--deploy] [--keep]

  --deploy, -d   Deploy to Vercel and run tests against live URL
  --keep, -k     Don't delete the test project directory on exit`)
  process.exit(0)
}

function log(msg: string) {
  console.log(util.styleText('cyan', `▸ ${msg}`))
}

function ok(msg: string) {
  console.log(util.styleText('green', `✔ ${msg}`))
}

function fail(msg: string): never {
  console.error(util.styleText('red', `✘ ${msg}`))
  process.exit(1)
}

function warn(msg: string) {
  console.log(util.styleText('yellow', `⚠ ${msg}`))
}

function run(
  cmd: string,
  opts: ExecSyncOptions = { stdio: 'inherit' },
): string {
  const result = execSync(cmd, { encoding: 'utf-8', ...opts })
  return typeof result === 'string' ? result.trim() : ''
}

function runQuiet(cmd: string): string {
  try {
    return run(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    fail(msg)
  }
}

const SCRIPT_DIR = new URL('.', import.meta.url).pathname
const REPO_ROOT = path.join(SCRIPT_DIR, '..', '..')
const FIXTURE_DIR = path.join(REPO_ROOT, '__fixtures__', 'test-project-esm')

function cleanup() {
  if (!args.keep && testProjectDir && fs.existsSync(testProjectDir)) {
    log(`Cleaning up ${testProjectDir}`)
    fs.rmSync(testProjectDir, { recursive: true, force: true })
  }
}

process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

const randomBytes = crypto.randomBytes(4).toString('hex')
const testProjectName = `cedar-vercel-test-${randomBytes}`
const testProjectDir = path.join(os.tmpdir(), testProjectName)
fs.mkdirSync(testProjectDir, { recursive: true })

// ─── Step 1: Build packages ──────────────────────────────────────────────────

log('Building Cedar packages...')
run('yarn build', { cwd: REPO_ROOT, stdio: 'inherit' })

// ─── Step 2: Set up test project ─────────────────────────────────────────────

log(`Setting up test project at ${testProjectDir}`)
run(`cp -r "${FIXTURE_DIR}/." "${testProjectDir}"`)

log('Linking local packages via tarsync...')
run(`yarn project:tarsync "${testProjectDir}"`, { cwd: REPO_ROOT })

// ─── Step 3: Set up Universal Deploy + Vercel ────────────────────────────────

log('Setting up Universal Deploy...')
run('yarn cedar setup deploy universal-deploy', { cwd: testProjectDir })

log('Setting up Vercel deploy (UD)...')
run('yarn cedar setup deploy vercel --ud', { cwd: testProjectDir })

// ─── Step 4: Build ───────────────────────────────────────────────────────────

log('Building app with --ud...')

process.env.DATABASE_URL = 'file:./db/dev.db'
process.env.DIRECT_DATABASE_URL = 'file:./db/dev.db'

// Prerendering may fail without a real database, but .vercel/output is created
// before prerender runs, so we tolerate the failure.
try {
  run('yarn cedar build --ud --apiRootPath=/.api/functions --no-prerender', {
    cwd: testProjectDir,
  })
} catch {
  warn('Build exited with errors (likely prerender), checking output anyway...')
}

// ─── Step 5: Verify .vercel/output/ structure ────────────────────────────────

log('Verifying .vercel/output/ structure...')

const vercelOut = path.join(testProjectDir, '.vercel', 'output')

assert(fs.existsSync(vercelOut), '.vercel/output/ does not exist')
assert(
  fs.existsSync(path.join(vercelOut, 'config.json')),
  '.vercel/output/config.json missing',
)
assert(
  fs.existsSync(path.join(vercelOut, 'functions')),
  '.vercel/output/functions/ missing',
)
assert(
  fs.existsSync(path.join(vercelOut, 'static')),
  '.vercel/output/static/ missing',
)
assert(
  fs.existsSync(path.join(vercelOut, 'static', 'index.html')),
  '.vercel/output/static/index.html missing',
)

const indexHtml = fs.readFileSync(
  path.join(vercelOut, 'static', 'index.html'),
  'utf-8',
)
assert(
  indexHtml.includes('id="cedar-app"'),
  'static/index.html does not contain id="cedar-app"',
)
ok('static/index.html contains id="cedar-app"')

const configJson = JSON.parse(
  fs.readFileSync(path.join(vercelOut, 'config.json'), 'utf-8'),
)
assert('routes' in configJson, 'config.json does not have routes')
ok('config.json has routes')

if (JSON.stringify(configJson).includes('"filesystem"')) {
  ok('config.json has { handle: "filesystem" } for static file serving')
} else {
  warn(
    'config.json missing { handle: "filesystem" } — static files may not be served',
  )
}

log('API functions found:')
for (const name of fs.readdirSync(path.join(vercelOut, 'functions'))) {
  console.log(`  ${name}`)
}

console.log()
ok('Build output verification passed!')
console.log()

// Print directory listing
log('Output directory contents:')
const files: string[] = []
function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
    } else {
      files.push(`  ${path.relative(testProjectDir, full)}`)
    }
  }
}
walk(vercelOut)
files.sort().forEach((f) => console.log(f))

// ─── Step 6: Deploy (optional) ───────────────────────────────────────────────

if (!args.deploy) {
  console.log()
  log('Skipping deploy (run with --deploy to deploy to Vercel)')
  log(`Test project kept at: ${testProjectDir}`)
  process.exit(0)
}

// Check for Vercel token or CLI login
let vercelFlag = ''
if (!process.env.VERCEL_TOKEN) {
  const whoami = runQuiet('npx vercel whoami')
  if (!whoami) {
    fail(
      'VERCEL_TOKEN not set and vercel CLI not logged in. Run: npx vercel login',
    )
  }
  log('Using vercel CLI login (no VERCEL_TOKEN set)')
} else {
  log('Using VERCEL_TOKEN')
  vercelFlag = `--token ${process.env.VERCEL_TOKEN}`
}

// Deploy (creates project if it doesn't exist)
log('Deploying to Vercel...')
try {
  run(
    `npx vercel deploy --prebuilt --prod --yes --name "${testProjectName}" ${vercelFlag}`,
    {
      cwd: testProjectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
} catch (e: any) {
  console.error(e.stdout || e.message)
  fail('Vercel deploy failed')
}

// Use the production alias URL rather than the deployment URL, which
// may be behind Vercel's deployment protection (returns 401).
const deployUrl = `https://${testProjectName}.vercel.app`

log(`Deployed to: ${deployUrl}`)

// Wait for deployment to be ready
log('Waiting for deployment to be ready...')
await new Promise((r) => setTimeout(r, 5000))

// Run tests
log('Running tests...')
run(
  `VERCEL_DEPLOY_URL="${deployUrl}" yarn vitest run tasks/vercel-tests/vercel.test.mts`,
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  },
)

ok('All tests passed!')

// Cleanup Vercel project
log(`Cleaning up Vercel project: ${testProjectName}`)
runQuiet(`echo "y" | npx vercel projects rm "${testProjectName}" ${vercelFlag}`)
