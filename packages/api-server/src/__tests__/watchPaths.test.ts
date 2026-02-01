import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import chokidar from 'chokidar'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { pathsToWatch } from '../watchPaths.js'

describe('workspacePackages integration with chokidar', () => {
  let tmpDir: string
  const originalRwjsCwd = process.env.RWJS_CWD

  beforeAll(async () => {
    // Create an isolated temp project directory
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'cedar-workspace-packages-test-'),
    )

    // Ensure we are recognized as a Cedar project
    await fs.promises.writeFile(path.join(tmpDir, 'cedar.toml'), '# cedar test')

    // Root package.json with workspace globs
    const rootPackageJson = {
      name: 'workspace-test',
      private: true,
      workspaces: ['packages/*'],
    }
    await fs.promises.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2),
    )

    // Create a workspace package with a `src` directory that will be watched
    const fooSrcDir = path.join(tmpDir, 'packages', 'foo', 'src')
    await fs.promises.mkdir(fooSrcDir, { recursive: true })
    const fooIndexPath = path.join(fooSrcDir, 'index.ts')
    await fs.promises.writeFile(fooIndexPath, 'export const foo = 1')

    // Create the `package.json` for the workspace package so
    // workspacePackages() will detect it as a workspace dependency from the
    // `api` package.
    await fs.promises.writeFile(
      path.join(tmpDir, 'packages', 'foo', 'package.json'),
      JSON.stringify({ name: 'foo', version: '1.0.0' }, null, 2),
    )

    // Create an `api` package that depends on the workspace package via
    // `workspace:*`
    const apiDir = path.join(tmpDir, 'api')
    await fs.promises.mkdir(apiDir, { recursive: true })
    const apiPackageJson = {
      name: 'api',
      version: '1.0.0',
      dependencies: {
        foo: 'workspace:*',
      },
    }
    await fs.promises.writeFile(
      path.join(apiDir, 'package.json'),
      JSON.stringify(apiPackageJson, null, 2),
      { encoding: 'utf8' },
    )

    // Tell project-config to treat our temp dir as the project root
    process.env.RWJS_CWD = tmpDir
  })

  afterAll(async () => {
    // Restore environment and cleanup
    if (originalRwjsCwd === undefined) {
      delete process.env.RWJS_CWD
    } else {
      process.env.RWJS_CWD = originalRwjsCwd
    }

    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('returns patterns that works with chokidar', async () => {
    // Get the patterns workspacePackages provides
    const patterns = await pathsToWatch()

    // If no patterns were returned, collect and assert helpful debug info so
    // failures on CI (particularly Windows runners) give actionable output.
    if (patterns.length === 0) {
      const packagesDir = path.join(tmpDir, 'packages')
      const packagesDirExists = fs.existsSync(packagesDir)
      expect(packagesDirExists).toBe(true)

      const packageJsonPath = path.join(packagesDir, 'foo', 'package.json')
      const packageJsonExists = fs.existsSync(packageJsonPath)
      expect(packageJsonExists).toBe(true)

      const rootPkg = JSON.parse(
        await fs.promises.readFile(path.join(tmpDir, 'package.json'), 'utf8'),
      )
      expect(Array.isArray(rootPkg.workspaces)).toBe(true)
      expect(
        rootPkg.workspaces.some((w: string) => w.startsWith('packages/')),
      ).toBe(true)

      const apiPkg = JSON.parse(
        await fs.promises.readFile(
          path.join(tmpDir, 'api', 'package.json'),
          'utf8',
        ),
      )
      expect(apiPkg.dependencies?.foo).toBe('workspace:*')

      const globPattern = path.join(packagesDir, '*').replaceAll('\\', '/')

      let packageDirs: string[] = []
      try {
        // Mirror the logic in `workspacePackages()` which uses fs.promises.glob
        // and Array.fromAsync to enumerate matching package directories.

        packageDirs = await Array.fromAsync(fs.promises.glob(globPattern))
      } catch (e: any) {
        console.log('glob error', e?.message ?? e)
      }

      console.log(
        JSON.stringify(
          { patterns, packagesDir, globPattern, packageDirs, rootPkg, apiPkg },
          null,
          2,
        ),
      )

      expect(packageDirs.length).toBeGreaterThan(0)
    }

    // Ensure we've normalized separators (no backslashes) so the test failure
    // is explicit if normalization doesn't happen.
    for (const p of patterns) {
      expect(p.includes('\\')).toBe(false)
    }

    // Diagnostic logging: show raw and normalized patterns so CI logs are
    // actionable if globbing doesn't behave as expected on a runner.
    console.log('workspace patterns', JSON.stringify(patterns, null, 2))

    // Diagnostic: expand the packages/* glob (like workspacePackages does) and
    // log the matches. This helps surface platform-specific globbing issues,
    // especially on Windows runners.
    try {
      const packagesDirForDebug = path.join(tmpDir, 'packages')
      const globPatternForDebug = path
        .join(packagesDirForDebug, '*')
        .replaceAll('\\', '/')

      const packageDirsForDebug = await Array.fromAsync(
        fs.promises.glob(globPatternForDebug),
      )
      console.log('packages glob pattern:', globPatternForDebug)
      console.log(
        'packages glob matches:',
        JSON.stringify(packageDirsForDebug, null, 2),
      )
    } catch (e: any) {
      console.log('packages glob error:', e?.message ?? e)
    }

    const watcher = chokidar.watch(patterns, {
      persistent: true,
      ignoreInitial: true,
    })

    // Surface watcher errors immediately to test logs
    watcher.on('error', (error) => {
      console.error('chokidar watcher error:', error)
    })

    try {
      // Wait until the watcher is ready
      await new Promise<void>((resolve) => {
        watcher.on('ready', () => {
          try {
            console.debug(
              'chokidar ready; watched directories:',
              JSON.stringify(watcher.getWatched(), null, 2),
            )
          } catch (e) {
            console.debug('chokidar ready; could not serialize watched dirs', e)
          }

          setTimeout(() => {
            console.log('Resolving onReady promise')
            // This might get called twice. For this test that doesn't matter
            resolve()
          }, 1000)
        })
      })

      // Prepare a promise that resolves when chokidar reports the change
      const eventPromise = new Promise<{ eventName: string; filePath: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timed out waiting for chokidar event'))
          }, 10_000)

          const onAll = (eventName: string, filePath: string) => {
            try {
              console.debug('chokidar event:', eventName, filePath)
            } catch (e) {
              console.debug('chokidar event logging failed', e)
            }

            // Normalize the reported path so this works across OSes
            const normalized = String(filePath).replace(/\\/g, '/')

            if (normalized.endsWith('/packages/foo/src/index.ts')) {
              clearTimeout(timeout)
              watcher.off('all', onAll)
              resolve({ eventName, filePath })
            }
          }

          watcher.on('all', onAll)
        },
      )

      // Trigger a change in the watched file
      const targetFile = path.join(tmpDir, 'packages', 'foo', 'src', 'index.ts')
      try {
        const beforeStat = await fs.promises.stat(targetFile)
        console.debug('targetFile mtime before append:', beforeStat.mtimeMs)
      } catch (e) {
        console.debug('stat before append failed:', e)
      }

      await fs.promises.appendFile(targetFile, '\n// update\n', {
        encoding: 'utf8',
      })

      try {
        const afterStat = await fs.promises.stat(targetFile)
        console.debug('targetFile mtime after append:', afterStat.mtimeMs)
      } catch (e) {
        console.debug('stat after append failed:', e)
      }

      const { eventName } = await eventPromise

      // chokidar could report either `add` (in some races) or `change` for the edit
      expect(['add', 'change']).toContain(eventName)
    } finally {
      // Always close the watcher
      await watcher.close()
    }
  }, 20_000)
})
