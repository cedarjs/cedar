import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { stripVTControlCharacters } from 'node:util'

const fixturesPath = path.join(
  import.meta.dirname,
  '__fixtures__',
  '8.x-set-wrapper-props',
)

function runScript(projectName: string) {
  return runScriptIn(path.join(fixturesPath, projectName))
}

function runScriptIn(projectPath: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, '8.x.ts')],
    {
      env: {
        ...process.env,
        CEDAR_CWD: projectPath,
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
    assert.match(stdout, /function PostsScaffoldLayout\(/)
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

  test('warns about files with Sets that cannot be parsed', () => {
    // Created at runtime, because a file with a syntax error can't be
    // committed as a fixture without failing the repo's formatting checks
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cedar-8x-unparsable-'),
    )

    try {
      fs.writeFileSync(path.join(projectPath, 'cedar.toml'), '')
      fs.mkdirSync(path.join(projectPath, 'web', 'src'), { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, 'web', 'src', 'Routes.tsx'),
        [
          "import { Router, Route, Set } from '@cedarjs/router'",
          '',
          'const Routes = () => (',
          '  <Router>',
          '    <Set wrap={ScaffoldLayout} title="Posts">',
          '      <Route path="/posts" page={PostsPage} name="posts" />',
          '    </Set',
          '  </Router>',
          ')',
        ].join('\n'),
      )

      const { status, stdout } = runScriptIn(projectPath)

      assert.equal(status, 0)
      assert.match(
        stdout,
        /Files with <Set> components that could not be checked/,
      )
      assert.match(stdout, / {2}web\/src\/Routes\.tsx\n/)
      assert.doesNotMatch(stdout, /<Set> props for wrapper components/)
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }
  })
})

describe('8.x: Prisma packages the project declares', () => {
  function createProject(
    rootPkg: Record<string, unknown>,
    apiPkg?: Record<string, unknown>,
  ) {
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cedar-8x-prisma-'),
    )

    fs.writeFileSync(path.join(projectPath, 'cedar.toml'), '')
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify(rootPkg),
    )

    if (apiPkg) {
      fs.mkdirSync(path.join(projectPath, 'api'))
      fs.writeFileSync(
        path.join(projectPath, 'api', 'package.json'),
        JSON.stringify(apiPkg),
      )
    }

    return projectPath
  }

  test('aborts and lists the Prisma packages the project is missing', () => {
    const projectPath = createProject(
      { devDependencies: { '@cedarjs/core': '7.1.0' } },
      { dependencies: { '@cedarjs/api': '7.1.0' } },
    )

    try {
      const { status, stdout } = runScriptIn(projectPath)

      assert.equal(status, 1)
      assert.match(stdout, /Prisma packages your project needs to declare/)
      assert.match(stdout, / {2}prisma in the devDependencies of package\.json/)
      assert.match(
        stdout,
        / {2}@prisma\/client in the dependencies of api\/package\.json/,
      )
      assert.match(stdout, /Use version \d+\.\d+\.\d+/)
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }
  })

  test('accepts Prisma packages in either dependency section', () => {
    const projectPath = createProject(
      { dependencies: { prisma: '7.10.1' } },
      { devDependencies: { '@prisma/client': '7.10.1' } },
    )

    try {
      const { status, stdout } = runScriptIn(projectPath)

      assert.equal(status, 0)
      assert.doesNotMatch(stdout, /Prisma packages/)
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }
  })

  test('skips projects without an api side', () => {
    const projectPath = createProject({
      devDependencies: { '@cedarjs/core': '7.1.0' },
    })

    try {
      const { status, stdout } = runScriptIn(projectPath)

      assert.equal(status, 0)
      assert.doesNotMatch(stdout, /Prisma packages/)
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }
  })
})
