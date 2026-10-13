/**
 * Adds the sandbox e2e function (api/src/functions/sandbox.ts) and its
 * sandboxed child scripts to a test project, and sharp, which one of the
 * children uses. Used by the Netlify and Vercel e2e workflows and their
 * local-test scripts.
 *
 * Usage: node tasks/sandbox-e2e/addToProject.mts <path-to-test-project>
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const projectDir = process.argv[2]
if (!projectDir) {
  console.error('Usage: node addToProject.mts <path-to-test-project>')
  process.exit(1)
}

const here = import.meta.dirname
const repoRoot = path.join(here, '..', '..')

fs.cpSync(path.join(here, 'api'), path.join(projectDir, 'api'), {
  recursive: true,
})

// The sharp version @cedarjs/api tests the sandbox with
const apiPackage = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, 'packages', 'api', 'package.json'),
    'utf8',
  ),
)
const sharpVersion: string = apiPackage.devDependencies.sharp

execFileSync('yarn', ['workspace', 'api', 'add', `sharp@${sharpVersion}`], {
  cwd: projectDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
