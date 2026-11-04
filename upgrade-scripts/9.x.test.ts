import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { promisify, stripVTControlCharacters } from 'node:util'

const execFileAsync = promisify(execFile)

const fixturesPath = path.join(import.meta.dirname, '__fixtures__', '9.x')

/**
 * Runs the script against a fixture project. Async, so the test's own registry
 * server keeps answering while the script runs
 */
async function runScript(
  projectName: string,
  env: Record<string, string> = {},
) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(import.meta.dirname, '9.x.ts')],
      {
        env: {
          ...process.env,
          CEDAR_CWD: path.join(fixturesPath, projectName),
          ...env,
        },
        encoding: 'utf8',
      },
    )

    return { status: 0, stdout: stripVTControlCharacters(stdout), stderr }
  } catch (e) {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      typeof e.code === 'number' &&
      'stdout' in e &&
      typeof e.stdout === 'string' &&
      'stderr' in e &&
      typeof e.stderr === 'string'
    ) {
      return {
        status: e.code,
        stdout: stripVTControlCharacters(e.stdout),
        stderr: e.stderr,
      }
    }

    throw e
  }
}

describe('9.x: the babel option of cedar()', () => {
  test('warns about a babel option passed to cedar()', async () => {
    const { status, stdout, stderr } = await runScript('babel-option')

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.match(stdout, /The `babel` option of cedar\(\) is not supported/)
    assert.match(stdout, /^ {2}web\/vite\.config\.ts:7$/m)
    assert.match(stdout, /We recommend moving your project off Babel/)
    assert.match(stdout, /^ {4}import babel from '@rolldown\/plugin-babel'$/m)
  })

  test('passes when cedar() gets no babel option', async () => {
    const { status, stdout, stderr } = await runScript('no-babel-option')

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.equal(stdout, '')
  })

  test("warns about cedar() calls whose options can't be checked", async () => {
    const { status, stdout, stderr } = await runScript('unchecked-options')

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.match(stdout, /cedar\(\) calls that could not be checked/)
    assert.match(
      stdout,
      /^ {2}web\/vite\.config\.js:8\n {2}web\/vite\.config\.js:9$/m,
    )
    assert.doesNotMatch(stdout, /is not supported/)
  })
})

describe('9.x: esbuild options', () => {
  test('lists which esbuild options are carried over and ignored', async () => {
    const { status, stdout, stderr } = await runScript('esbuild-options')

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.match(stdout, /Vite options for esbuild/)

    const reported = stdout
      .split('\n')
      .filter((line) => /^ {2}web\//.test(line) || /^ {4}\S/.test(line))

    assert.deepEqual(reported, [
      '  web/vite.config.ts:9 esbuild',
      '    carried over: jsxFactory',
      '    ignored: target',
      '  web/vite.config.ts:14 optimizeDeps.esbuildOptions',
      '    carried over: define',
      '    ignored: plugins',
      "    and options from a spread, which couldn't be checked",
    ])
  })
})

describe('9.x: React Compiler', () => {
  let server: http.Server
  let registry: string
  const requestedUrls: string[] = []

  before(async () => {
    server = http.createServer((req, res) => {
      requestedUrls.push(req.url ?? '')
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          name: '@cedarjs/vite',
          peerDependencies: { 'oxc-transform-react': '0.156.0' },
        }),
      )
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))

    // A server listening on a port, not a pipe, has an AddressInfo address
    const { port } = server.address() as AddressInfo
    registry = `http://localhost:${port}/`
  })

  after(() => {
    server.close()
  })

  test('aborts with the commands that install oxc-transform-react', async () => {
    const { status, stdout, stderr } = await runScript(
      'react-compiler-missing',
      { npm_config_registry: registry },
    )

    assert.equal(stderr, '')
    assert.equal(status, 1)
    assert.match(stdout, /React Compiler needs oxc-transform-react/)
    assert.match(
      stdout,
      /^ {4}yarn workspace web remove babel-plugin-react-compiler\n {4}yarn workspace web add -D oxc-transform-react@0\.156\.0$/m,
    )
    assert.equal(requestedUrls.length, 1)
    assert.match(requestedUrls[0], /^\/@cedarjs%2fvite\/[^/]+$/)
  })

  test("warns without aborting when the version can't be looked up", async () => {
    const { status, stdout, stderr } = await runScript(
      'react-compiler-missing',
      // Nothing listens on port 9
      { npm_config_registry: 'http://localhost:9/' },
    )

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.match(stdout, /React Compiler needs oxc-transform-react/)
    assert.match(stdout, /yarn cedar experimental setup-react-compiler --force/)
  })

  test('passes when the web side has oxc-transform-react', async () => {
    const { status, stdout, stderr } = await runScript('react-compiler-ready')

    assert.equal(stderr, '')
    assert.equal(status, 0)
    assert.equal(stdout, '')
  })
})
