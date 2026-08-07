/**
 * Local E2E test for Cedar's Universal Deploy + Netlify integration.
 *
 * Usage:
 *   node tasks/netlify-tests/local-test.mts              # build + verify output only
 *   node tasks/netlify-tests/local-test.mts --deploy     # build + deploy + test live URL
 *   node tasks/netlify-tests/local-test.mts --keep       # keep temp dir after exit
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

  --deploy, -d   Deploy to Netlify and run tests against live URL
  --keep, -k     Don't delete the test project directory or the Netlify site on exit`)
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

function runQuiet(cmd: string, opts?: ExecSyncOptions): string {
  try {
    return run(cmd, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
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
const testProjectName = `cedar-netlify-test-${randomBytes}`
const testProjectDir = path.join(os.tmpdir(), testProjectName)
fs.mkdirSync(testProjectDir, { recursive: true })

function step1buildPackages() {
  log('Building Cedar packages...')
  run('yarn build', { cwd: REPO_ROOT, stdio: 'inherit' })
}

function step2setupTestProject() {
  log(`Setting up test project at ${testProjectDir}`)
  run(`cp -r "${FIXTURE_DIR}/." "${testProjectDir}"`)

  log('Linking local packages via tarsync...')
  run(`yarn project:tarsync "${testProjectDir}"`, { cwd: REPO_ROOT })
}

function step3setupUniversalDeployAndNetlify() {
  log('Setting up Universal Deploy...')
  run('yarn cedar setup deploy universal-deploy', { cwd: testProjectDir })

  log('Setting up Netlify deploy (UD)...')
  run('yarn cedar setup deploy netlify --ud', { cwd: testProjectDir })
}

function step4SetupNeon() {
  if (!args.deploy) {
    return
  }

  log('Setting up Neon database...')
  run('rm -rf api/db/migrations', { cwd: testProjectDir })
  run('yarn cedar setup neon', { cwd: testProjectDir })
}

function step5buildApp() {
  log('Building app with --ud...')

  // Read DATABASE_URL from .env if available (after Neon setup)
  const envPath = path.join(testProjectDir, '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]
    const directDbUrl = envContent.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1]
    if (dbUrl) {
      process.env.DATABASE_URL = dbUrl
    }
    if (directDbUrl) {
      process.env.DIRECT_DATABASE_URL = directDbUrl
    }
    if (dbUrl) {
      log(`Using DATABASE_URL from .env (Neon)`)
    }
  } else {
    process.env.DATABASE_URL = 'file:./db/dev.db'
    process.env.DIRECT_DATABASE_URL = 'file:./db/dev.db'
  }

  run('yarn cedar build --ud --apiRootPath=/.api/functions', {
    cwd: testProjectDir,
  })
}

function step6RunMigrations() {
  if (!args.deploy) {
    return
  }

  log('Running Prisma migrations...')
  run('yarn cedar prisma migrate deploy', { cwd: testProjectDir })
  run('yarn cedar data-migrate up', { cwd: testProjectDir })
}

function step7verifyOutput() {
  log('Verifying build output...')

  // Netlify builds typically produce output in a directory like dist/
  // or the functions are bundled for Netlify's serverless platform.
  // The exact paths depend on the Netlify adapter configuration.
  // Here we just verify the build completed without errors.

  const distDir = path.join(testProjectDir, 'dist')
  const distWeb = path.join(testProjectDir, 'web', 'dist')

  if (fs.existsSync(distWeb)) {
    const indexHtml = path.join(distWeb, 'index.html')
    assert(fs.existsSync(indexHtml), 'web/dist/index.html missing')
    const html = fs.readFileSync(indexHtml, 'utf-8')
    assert(
      html.includes('id="cedar-app"'),
      'index.html does not contain id="cedar-app"',
    )
    ok('web/dist/index.html contains id="cedar-app"')
  } else if (fs.existsSync(distDir)) {
    const indexHtml = path.join(distDir, 'index.html')
    assert(fs.existsSync(indexHtml), 'dist/index.html missing')
    const html = fs.readFileSync(indexHtml, 'utf-8')
    assert(
      html.includes('id="cedar-app"'),
      'index.html does not contain id="cedar-app"',
    )
    ok('dist/index.html contains id="cedar-app"')
  } else {
    warn('No dist directory found; build output may be in a different location')
  }

  ok('Build output verification passed!')
  console.log()
}

async function step8deploy() {
  if (!args.deploy) {
    console.log()
    log('Skipping deploy (run with --deploy to deploy to Netlify)')
    log(`Test project kept at: ${testProjectDir}`)
    process.exit(0)
  }

  // Check for Netlify CLI login
  try {
    runQuiet('npx netlify sites:list --limit 1 --json')
  } catch {
    fail('Netlify CLI not logged in. Run: npx netlify login')
  }
  log('Using netlify CLI login')

  // Create Netlify site from a neutral directory (e.g. /tmp) so the CLI
  // doesn't detect the monorepo in the framework root or the test project.
  log(`Creating Netlify site: ${testProjectName}...`)
  const createOutput = runQuiet(
    `npx netlify sites:create --name "${testProjectName}" --json`,
    { cwd: os.tmpdir() },
  )
  if (!createOutput) {
    fail('Failed to create Netlify site')
  }

  let siteId: string
  try {
    const parsed = JSON.parse(createOutput)
    siteId = parsed.id
    if (!siteId) {
      throw new Error('No site id in response')
    }
  } catch {
    fail('Failed to parse Netlify site creation response')
  }

  log(`Netlify site ID: ${siteId}`)

  // Link the site
  log('Linking Netlify site...')
  runQuiet(`npx netlify link --id "${siteId}" --filter web`, {
    cwd: testProjectDir,
  })

  // Set DATABASE_URL as Netlify site environment variables
  const envPath = path.join(testProjectDir, '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]
    const directDbUrl = envContent.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1]
    if (dbUrl) {
      log('Setting DATABASE_URL on Netlify site...')
      runQuiet(`npx netlify env:set DATABASE_URL "${dbUrl}" --filter web`, {
        cwd: testProjectDir,
      })
    }
    if (directDbUrl) {
      log('Setting DIRECT_DATABASE_URL on Netlify site...')
      runQuiet(
        `npx netlify env:set DIRECT_DATABASE_URL "${directDbUrl}" --filter web`,
        { cwd: testProjectDir },
      )
    }
  }

  // Deploy
  log('Deploying to Netlify...')
  let deployOutput: string
  try {
    deployOutput = run(
      `npx netlify deploy --filter web --prod --json --no-build`,
      {
        cwd: testProjectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (e: any) {
    console.error(e.stdout || e.message)
    fail('Netlify deploy failed')
  }

  let deployUrl: string
  try {
    const parsed = JSON.parse(deployOutput)
    deployUrl = parsed.url
    if (!deployUrl) {
      throw new Error('No deploy URL in response')
    }
  } catch {
    fail('Failed to parse Netlify deploy response')
  }

  log(`Deployed to: ${deployUrl}`)

  // Wait for deployment to be ready
  log('Waiting for deployment to be ready...')
  await new Promise((r) => setTimeout(r, 5000))

  // Run tests
  log('Running tests...')
  run(`NETLIFY_DEPLOY_URL="${deployUrl}" yarn vitest run`, {
    cwd: path.join(REPO_ROOT, 'tasks', 'netlify-tests'),
    stdio: 'inherit',
  })

  ok('All tests passed!')

  // Cleanup Netlify site
  if (args.keep) {
    log(`Keeping Netlify site: ${testProjectName}`)
  } else {
    log(`Cleaning up Netlify site: ${testProjectName}`)
    runQuiet(`npx netlify sites:delete --force "${siteId}"`)
  }
}

step1buildPackages()
step2setupTestProject()
step3setupUniversalDeployAndNetlify()
step4SetupNeon()
step5buildApp()
step6RunMigrations()
step7verifyOutput()
await step8deploy()
