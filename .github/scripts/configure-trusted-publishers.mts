/**
 * Configures npm trusted publishing (GitHub Actions / OIDC) for every
 * publishable package in the monorepo, via the `npm trust` CLI command
 * (npm CLI >= 11.15.0).
 *
 * This is a one-time (or occasional, e.g. for a newly added package)
 * maintenance step, run locally by a maintainer -- not part of CI. It
 * requires write access to every package and 2FA enabled on the npm
 * account. `npm trust` re-authenticates with an OTP periodically, so
 * packages are configured serially with a short delay between calls to
 * avoid tripping the registry's rate limits and to fit comfortably inside
 * one OTP's validity window.
 *
 * Every package is pointed at the same workflow (`publish.yml`) with no
 * environment, since only the `release` job inside it uses one -- see
 * docs/implementation-plans/trusted-publishing.md.
 *
 * Usage: node .github/scripts/configure-trusted-publishers.mts [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

const REPO_ROOT = process.cwd()
const REPO = 'cedarjs/cedar'
const WORKFLOW_FILE = 'publish.yml'
const DELAY_BETWEEN_CALLS_MS = 2000

const isDryRun = process.argv.includes('--dry-run')

interface WorkspaceInfo {
  name: string
  location: string
}

interface PackageJson {
  name?: string
  private?: boolean
}

function log(message: string) {
  console.log(`${isDryRun ? '[DRY-RUN] ' : ''}${message}`)
}

function getPublishablePackageNames(): string[] {
  const workspaces = execFileSync('yarn', ['workspaces', 'list', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as WorkspaceInfo)
    .filter((ws) => ws.location !== '.')

  const names: string[] = []

  for (const ws of workspaces) {
    const pkgJsonPath = path.join(REPO_ROOT, ws.location, 'package.json')
    const pkgJson = JSON.parse(
      fs.readFileSync(pkgJsonPath, 'utf-8'),
    ) as PackageJson

    if (pkgJson.private) {
      continue
    }

    if (!pkgJson.name) {
      throw new Error(`Missing name in ${pkgJsonPath}`)
    }

    names.push(pkgJson.name)
  }

  return names
}

async function main() {
  const packages = getPublishablePackageNames()
  log(`Configuring trusted publishing for ${packages.length} packages`)

  const failures: string[] = []

  for (const [index, name] of packages.entries()) {
    log(`[${index + 1}/${packages.length}] ${name}`)

    const args = [
      'trust',
      'github',
      name,
      '--repo',
      REPO,
      '--file',
      WORKFLOW_FILE,
      '--allow-publish',
      '--yes',
    ]

    if (isDryRun) {
      log(`  Would run: npm ${args.join(' ')}`)
    } else {
      try {
        execFileSync('npm', args, { cwd: REPO_ROOT, stdio: 'inherit' })
      } catch {
        console.error(`❌ Failed to configure ${name}`)
        failures.push(name)
      }
    }

    if (index < packages.length - 1) {
      await setTimeout(DELAY_BETWEEN_CALLS_MS)
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} package(s) failed: ${failures.join(', ')}`,
    )
    process.exitCode = 1
  } else {
    log('Done')
  }
}

main()
