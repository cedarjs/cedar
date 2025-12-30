import fs from 'node:fs'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import execa from 'execa'
import type { ExecaError } from 'execa'
import semver from 'semver'

function isExecaError(e: unknown): e is ExecaError {
  return (
    e instanceof Error && ('stdout' in e || 'stderr' in e || 'exitCode' in e)
  )
}

export async function runPreUpgradeScripts(
  ctx: Record<string, unknown>,
  task: { output: unknown },
  { verbose, force }: { verbose?: boolean; force?: boolean },
) {
  if (!ctx.versionToUpgradeTo) {
    return
  }

  const version =
    typeof ctx.versionToUpgradeTo === 'string'
      ? ctx.versionToUpgradeTo
      : undefined

  const parsed = semver.parse(version)
  const baseUrl =
    'https://raw.githubusercontent.com/cedarjs/cedar/main/upgrade-scripts/'
  const manifestUrl = `${baseUrl}manifest.json`

  let manifest: string[] = []
  try {
    const res = await fetch(manifestUrl)

    if (res.status === 200) {
      manifest = await res.json()
    } else {
      if (verbose) {
        console.log('No upgrade script manifest found.')
      }
    }
  } catch (e) {
    if (verbose) {
      console.log('Failed to fetch upgrade script manifest', e)
    }
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    return
  }

  const checkLevels: { id: string; candidates: string[] }[] = []
  if (parsed && !parsed.prerelease.length) {
    // 1. Exact match: 3.4.1
    checkLevels.push({
      id: 'exact',
      candidates: [`${version}.ts`, `${version}/index.ts`],
    })

    // 2. Patch wildcard: 3.4.x
    checkLevels.push({
      id: 'patch',
      candidates: [
        `${parsed.major}.${parsed.minor}.x.ts`,
        `${parsed.major}.${parsed.minor}.x/index.ts`,
      ],
    })

    // 3. Minor wildcard: 3.x
    checkLevels.push({
      id: 'minor',
      candidates: [`${parsed.major}.x.ts`, `${parsed.major}.x/index.ts`],
    })
  } else if (parsed && parsed.prerelease.length > 0) {
    // `parsed.prerelease[0]` is the prerelease tag, e.g. 'canary'
    checkLevels.push({
      id: 'tag',
      candidates: [
        `${parsed.prerelease[0]}.ts`,
        `${parsed.prerelease[0]}/index.ts`,
      ],
    })
  }

  const scriptsToRun: string[] = []

  // Find all existing scripts (one per level) using the manifest
  for (const level of checkLevels) {
    // Check both <version>.ts and <version>/index.ts
    for (const candidate of level.candidates) {
      if (manifest.includes(candidate)) {
        scriptsToRun.push(candidate)

        // Found a script for this level, move to next level
        break
      }
    }
  }

  if (scriptsToRun.length === 0) {
    if (verbose) {
      console.log(`No upgrade scripts found for ${version}`)
    }

    return
  }

  ctx.preUpgradeMessage = ''
  ctx.preUpgradeError = ''

  // Run them sequentially
  for (const scriptName of scriptsToRun) {
    task.output = `Found upgrade check script: ${scriptName}. Downloading...`

    const tempDir = await fs.promises.mkdtemp(
      // realpath: https://github.com/e18e/ecosystem-issues/issues/168
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-upgrade-'),
    )
    const scriptPath = path.join(tempDir, 'script.mts')

    // Check if this is a directory-based script (e.g., 3.4.1/index.ts)
    const isDirectoryScript = scriptName.includes('/')

    if (isDirectoryScript) {
      // Extract directory name (e.g., "3.4.1" from "3.4.1/index.ts")
      const dirName = scriptName.split('/')[0]
      const githubApiUrl = `https://api.github.com/repos/cedarjs/cedar/contents/upgrade-scripts/${dirName}`

      try {
        // Fetch directory contents from GitHub API
        const dirRes = await fetch(githubApiUrl, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        })

        if (dirRes.status !== 200) {
          throw new Error(
            `Failed to fetch directory contents: ${dirRes.statusText}`,
          )
        }

        const files = await dirRes.json()

        // Download all files in the directory
        for (const file of files) {
          if (file.type === 'file') {
            task.output = `Downloading ${file.name}...`

            const fileRes = await fetch(file.download_url)

            if (fileRes.status !== 200) {
              throw new Error(`Failed to download ${file.name}`)
            }

            const fileContent = await fileRes.text()
            const filePath = path.join(tempDir, file.name)
            await fs.promises.writeFile(filePath, fileContent)

            // Rename index.ts to script.mts for execution
            if (file.name === 'index.ts') {
              await fs.promises.rename(filePath, scriptPath)
            }
          }
        }
      } catch (e) {
        if (verbose) {
          console.error(e)
        }
        throw new Error(
          `Failed to download upgrade script directory from ${githubApiUrl}`,
        )
      }
    } else {
      // Single file script - download directly
      const scriptUrl = `${baseUrl}${scriptName}`
      try {
        const res = await fetch(scriptUrl)

        if (res.status !== 200) {
          throw new Error(`Failed to download script: ${res.statusText}`)
        }

        const scriptContent = await res.text()
        await fs.promises.writeFile(scriptPath, scriptContent)
      } catch (e) {
        if (verbose) {
          console.error(e)
        }
        throw new Error(`Failed to download upgrade script from ${scriptUrl}`)
      }
    }

    // Read script content for dependency extraction
    const scriptContent = await fs.promises.readFile(scriptPath, 'utf8')
    const deps = extractDependencies(scriptContent)

    if (deps.length > 0) {
      const depList = deps.join(', ')
      task.output = `Installing dependencies for ${scriptName}: ${depList}...`

      await fs.promises.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'pre-upgrade-script',
          version: '0.0.0',
          dependencies: {},
        }),
      )

      // Use npm because it's the one package manager we can know everyone has
      // installed. And we don't have to worry about versions either as it
      // tracks with the node version.
      await execa('npm', ['install', ...deps], { cwd: tempDir })
    }

    task.output = `Running pre-upgrade script: ${scriptName}...`
    let shouldCleanup = true
    try {
      const { stdout } = await execa(
        'node',
        ['script.mts', '--verbose', String(verbose), '--force', String(force)],
        { cwd: tempDir },
      )

      if (stdout) {
        if (ctx.preUpgradeMessage) {
          ctx.preUpgradeMessage += '\n'
        }

        ctx.preUpgradeMessage += `\n${stdout}`
      }
    } catch (e) {
      let errorOutput = String(e)
      let exitCode: number | undefined
      let stderr: string | undefined

      if (isExecaError(e)) {
        errorOutput = e.stdout || e.message
        stderr = e.stderr
        exitCode = e.exitCode
      } else if (e instanceof Error) {
        errorOutput = e.message
      }

      if (ctx.preUpgradeError) {
        ctx.preUpgradeError += '\n'
      }

      if (verbose) {
        ctx.preUpgradeError +=
          `\nPre-upgrade check ${scriptName} failed with exit code ` +
          `${exitCode}:\n${stderr ? stderr + '\n' : ''}`
      }

      ctx.preUpgradeError += `\n${errorOutput}`

      if (!force) {
        await fs.promises.rm(tempDir, { recursive: true })
        shouldCleanup = false

        // Return to skip remaining pre-upgrade scripts
        return
      }
    } finally {
      if (shouldCleanup) {
        await fs.promises.rm(tempDir, { recursive: true })
      }
    }
  }
}

const extractDependencies = (content: string) => {
  const deps = new Map()

  // 1. Explicit dependencies via comments
  // Example: // @dependency: lodash@^4.0.0
  const commentRegex = /\/\/\s*@dependency:\s*(\S+)/g
  let match
  while ((match = commentRegex.exec(content)) !== null) {
    const spec = match[1]
    // Extract name from specifier (e.g., 'foo@1.0.0' -> 'foo', '@scope/pkg@2' -> '@scope/pkg')
    const nameMatch = spec.match(/^(@?[^@\s]+)(?:@.+)?$/)
    if (nameMatch) {
      deps.set(nameMatch[1], spec)
    }
  }

  // 2. Implicit dependencies via imports
  const importRegex = /(?:import|from)\s*\(?['"]([^'"]+)['"]\)?/g

  while ((match = importRegex.exec(content)) !== null) {
    let name = match[1]

    if (
      name.startsWith('.') ||
      name.startsWith('/') ||
      name.startsWith('node:') ||
      builtinModules.includes(name)
    ) {
      continue
    }

    const parts = name.split('/')

    if (name.startsWith('@') && parts.length >= 2) {
      name = parts.slice(0, 2).join('/')
    } else if (parts.length >= 1) {
      name = parts[0]
    }

    // Explicit comments take precedence
    if (!deps.has(name)) {
      deps.set(name, name)
    }
  }

  return Array.from(deps.values())
}
