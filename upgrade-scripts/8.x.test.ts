import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, test } from 'node:test'
import { stripVTControlCharacters } from 'node:util'

const fixturesPath = path.join(
  import.meta.dirname,
  '__fixtures__',
  '8.x-set-wrapper-props',
)

function runScript(projectName: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, '8.x.ts')],
    {
      env: {
        ...process.env,
        CEDAR_CWD: path.join(fixturesPath, projectName),
      },
      encoding: 'utf8',
    },
  )

  return {
    status: result.status,
    stdout: stripVTControlCharacters(result.stdout),
    stderr: result.stderr,
  }
}

describe('8.x: Sets with props for their wrappers', () => {
  test('reports every Set with props in TS files and aborts', () => {
    const { status, stdout, stderr } = runScript('ts-project')

    assert.equal(stderr, '')
    assert.equal(status, 1)
    assert.match(stdout, /<Set> props for wrapper components/)

    const reported = stdout
      .split('\n')
      .filter((line) => /^ {2}\S/.test(line) || /^ {4}(wrap|props):/.test(line))

    assert.deepEqual(reported, [
      '  web/src/layouts/AdminRoutes.tsx:6 <Set>',
      '    wrap: AdminLayout',
      '    props: level',
      '  web/src/layouts/AdminRoutes.tsx:14 <Set>',
      '    wrap: AdminLayout',
      '    props: {...layoutProps}',
      '  web/src/Routes.tsx:13 <Set>',
      '    wrap: ScaffoldLayout',
      '    props: title, titleTo, buttonLabel, buttonTo',
      '  web/src/Routes.tsx:23 <Set>',
      '    wrap: [MainLayout, ThemeLayout]',
      '    props: theme',
      '  web/src/Routes.tsx:30 <PrivateSet>',
      '    wrap: MainLayout',
      '    props: section',
      '  web/src/Routes.tsx:38 <Private>',
      '    wrap: (none)',
      '    props: title',
    ])
    assert.match(stdout, /const PostsScaffoldLayout = /)
  })

  test('reports Sets with props in JS files', () => {
    const { status, stdout } = runScript('js-project')

    assert.equal(status, 1)
    assert.match(
      stdout,
      / {2}web\/src\/Routes\.jsx:9 <Set>\n {4}wrap: ScaffoldLayout\n {4}props: title, titleTo\n/,
    )
    assert.doesNotMatch(stdout, /Routes\.jsx:12/)
  })

  test('does not report Sets that only use their own props', () => {
    const { status, stdout } = runScript('no-props-project')

    assert.equal(status, 0)
    assert.doesNotMatch(stdout, /<Set> props for wrapper components/)
  })
})
