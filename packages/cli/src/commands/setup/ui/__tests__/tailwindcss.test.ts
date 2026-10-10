vi.mock('node:fs', async () => ({ ...memfsFs, default: { ...memfsFs } }))

vi.mock('@cedarjs/cli-helpers/packageManager/packages', () => ({
  addRootPackages: () => {},
  addWorkspacePackages: () => {},
  removeWorkspacePackages: () => {},
  installPackages: () => {},
}))

vi.mock('@cedarjs/cli-helpers/packageManager/display', () => ({
  formatInstallCommand: () => 'yarn install',
  formatCedarCommand: (args: string[] = []) => `yarn cedar ${args.join(' ')}`,
  formatRunBinCommand: (bin: string, args: string[] = []) =>
    `yarn ${bin} ${args.join(' ')}`,
  formatRunWorkspaceBinCommand: () => '',
  formatRunScriptCommand: () => '',
  formatRunWorkspaceScriptCommand: () => '',
  formatDlxCommand: () => '',
  formatAddRootPackagesCommand: () => '',
  formatAddWorkspacePackagesCommand: () => '',
  formatRemoveWorkspacePackagesCommand: () => '',
}))

vi.mock('@cedarjs/cli-helpers/packageManager', () => ({
  add: () => 'add',
  install: () => 'install',
  dedupe: () => undefined,
  dedupeIsSupported: () => false,
  installationErrorMessage: () => 'install error',
  workspacePackageSpecifier: () => '*',
  prettyPrintCedarCommand: (args: string[] = []) =>
    `yarn cedar ${args.join(' ')}`,
}))

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: () => 'yarn',
}))

vi.mock('listr2', () => {
  return {
    // Return a constructor function, since we're calling `new` on Listr
    Listr: Listr2Mock,
  }
})

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import {
  vi,
  expect,
  it,
  describe,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest'

import { Listr2Mock } from '../../../../__tests__/Listr2Mock.js'
// @ts-expect-error - no types
import { handler } from '../libraries/tailwindcssHandler.js'

// Set up CEDAR_CWD
let original_CEDAR_CWD: string | undefined
const APP_PATH = '/redwood-app'

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = APP_PATH
})

beforeEach(() => {
  // The `recommendExtensionsToInstall` function uses `console.log` to output
  // the list of recommended extensions. We mock it to keep the output clean
  // during tests
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  Listr2Mock.mockPrompt = undefined
  vi.mocked(console).log.mockRestore()
  vol.reset()
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
  vi.resetAllMocks()
  vi.resetModules()
})

describe('tasks that should be skipped', () => {
  it('should skip installing if called with `install: false`', async () => {
    setupDefaultProjectStructure()

    await handler({ install: false })

    expect(Listr2Mock.skippedTaskTitles[0]).toEqual(
      'Installing project-wide packages...',
    )
    expect(Listr2Mock.skippedTaskTitles[1]).toEqual(
      'Installing web side packages...',
    )
  })

  it("should skip adding the import to index.css if it's already in there", async () => {
    setupDefaultProjectStructure({
      'web/src/index.css': '@import "tailwindcss";\n',
    })

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toContain(
      'Tailwind CSS import already exists in index.css',
    )
  })

  it("should skip updating scaffold.css if it doesn't exist", async () => {
    // No scaffold.css file is the default
    setupDefaultProjectStructure()

    Listr2Mock.mockPrompt = vi.fn()

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toContain(
      "No 'scaffold.css' file to update",
    )
    expect(Listr2Mock.mockPrompt).not.toHaveBeenCalled()
  })

  it('should skip updating scaffold.css if the user answers "no" to the prompt', async () => {
    setupDefaultProjectStructure({
      'web/src/scaffold.css': [
        '.rw-scaffold *,',
        '.rw-scaffold ::after,',
        '.rw-scaffold ::before {',
        '  box-sizing: inherit;',
        '}',
      ].join('\n'),
    })

    Listr2Mock.mockPrompt = vi.fn().mockReturnValue({ default: false })

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toContain(
      "Skipping 'scaffold.css' update",
    )
    expect(Listr2Mock.mockPrompt).toHaveBeenCalledWith([
      {
        name: 'default',
        type: 'Confirm',
        message:
          "Do you want to override your 'scaffold.css' to use tailwind classes?",
      },
    ])
  })

  it('should skip adding recommended VS Code extensions to project settings if the user is not using VS Code', async () => {
    setupDefaultProjectStructure()
    // Delete the .vscode directory to simulate not using VS Code
    memfsFs.rmSync(path.join(APP_PATH, '.vscode'), { recursive: true })

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toContain(
      "Looks like you're not using VS Code",
    )
  })

  it('should skip adding tailwind intellisense plugin config to VS Code settings if the user is not using VS Code', async () => {
    setupDefaultProjectStructure()
    memfsFs.rmSync(path.join(APP_PATH, '.vscode'), { recursive: true })

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toMatchInlineSnapshot(`
      [
        "Installing project-wide packages...",
        "Installing web side packages...",
        "No 'scaffold.css' file to update",
        "Looks like you're not using VS Code",
        "Looks like you're not using VS Code",
      ]
    `)
  })
})

describe('index.css', () => {
  it('adds the tailwind import at the top of index.css', async () => {
    setupDefaultProjectStructure({
      'web/src/index.css': 'body {\n  margin: 0;\n}\n',
    })

    await handler({})

    const indexCss = readAppFile('web/src/index.css')
    expect(indexCss.startsWith('/**')).toBe(true)
    expect(indexCss).toContain("@import 'tailwindcss';")
    expect(indexCss.endsWith('body {\n  margin: 0;\n}\n')).toBe(true)
  })
})

describe('prettier config', () => {
  const prettierConfig = ['module.exports = {', '  semi: false,', '}', ''].join(
    '\n',
  )

  it('adds the tailwind stylesheet and plugin', async () => {
    setupDefaultProjectStructure({ 'prettier.config.cjs': prettierConfig })

    await handler({})

    expect(readAppFile('prettier.config.cjs')).toEqual(
      [
        'module.exports = {',
        '  semi: false,',
        "  tailwindStylesheet: './web/src/index.css',",
        "  plugins: ['prettier-plugin-tailwindcss'],",
        '}',
        '',
      ].join('\n'),
    )
  })

  it('only replaces the stylesheet entry when called with --force', async () => {
    setupDefaultProjectStructure({
      'prettier.config.cjs': [
        'module.exports = {',
        "  tailwindStylesheet: './old.css', plugins: ['prettier-plugin-tailwindcss'],",
        '}',
        '',
      ].join('\n'),
    })

    await handler({ force: true })

    expect(readAppFile('prettier.config.cjs')).toEqual(
      [
        'module.exports = {',
        "  tailwindStylesheet: './web/src/index.css', plugins: ['prettier-plugin-tailwindcss'],",
        '}',
        '',
      ].join('\n'),
    )
  })
})

describe('vite config', () => {
  it('adds the Tailwind CSS plugin and its import', async () => {
    setupDefaultProjectStructure()

    await handler({})

    expect(readAppFile('web/vite.config.ts')).toEqual(
      [
        '/// <reference types="vitest/config" />',
        '',
        "import tailwindcss from '@tailwindcss/vite'",
        "import { defineConfig } from 'vite'",
        '',
        "import { cedar } from '@cedarjs/vite'",
        '',
        'export default defineConfig(({ mode }) => ({',
        '  plugins: [',
        '    tailwindcss(),',
        '    cedar({ mode }),',
        '  ],',
        '}))',
        '',
      ].join('\n'),
    )
  })

  it('skips adding the plugin if it is already there', async () => {
    const viteConfig = [
      "import tailwindcss from '@tailwindcss/vite'",
      "import { defineConfig } from 'vite'",
      '',
      "import { cedar } from '@cedarjs/vite'",
      '',
      'export default defineConfig({',
      '  plugins: [tailwindcss(), cedar()],',
      '})',
      '',
    ].join('\n')
    setupDefaultProjectStructure({ 'web/vite.config.ts': viteConfig })

    await handler({})

    expect(Listr2Mock.skippedTaskTitles).toContain(
      'The Tailwind CSS Vite plugin is already configured',
    )
    expect(readAppFile('web/vite.config.ts')).toEqual(viteConfig)
  })
})

describe('tailwindcss intellisense settings', () => {
  it('associates css files with tailwindcss, keeping other associations', async () => {
    setupDefaultProjectStructure({
      '.vscode/settings.json': JSON.stringify({
        'files.associations': { '*.mdx': 'markdown' },
      }),
    })

    await handler({})

    expect(JSON.parse(readVsCodeSettings())['files.associations']).toEqual({
      '*.mdx': 'markdown',
      '*.css': 'tailwindcss',
    })
  })

  it('creates a new settings file when none exists', async () => {
    setupDefaultProjectStructure({
      '.vscode/': null, // empty directory
    })

    await handler({})

    const settingsJson = JSON.parse(readVsCodeSettings())
    const twClassAttributes = settingsJson['tailwindCSS.classAttributes']

    expect(Array.isArray(twClassAttributes)).toBe(true)
    expect(twClassAttributes).toContain('class')
    expect(twClassAttributes).toContain('className')
    expect(twClassAttributes).toContain('activeClassName')
    expect(twClassAttributes).toContain('errorClassName')
    expect(twClassAttributes.length).toBe(4)
  })

  it('adds to existing empty settings file', async () => {
    setupDefaultProjectStructure({
      '.vscode/settings.json': '',
    })

    await handler({})

    const settingsJson = JSON.parse(readVsCodeSettings())
    const twClassAttributes = settingsJson['tailwindCSS.classAttributes']

    expect(Object.keys(settingsJson).length).toBe(2)
    expect(Array.isArray(twClassAttributes)).toBe(true)
    expect(twClassAttributes).toContain('class')
    expect(twClassAttributes).toContain('className')
    expect(twClassAttributes).toContain('activeClassName')
    expect(twClassAttributes).toContain('errorClassName')
    expect(twClassAttributes.length).toBe(4)
  })

  it('adds to existing settings file without any tailwindCSS settings', async () => {
    setupDefaultProjectStructure({
      '.vscode/settings.json': [
        '{',
        '  "editor.tabSize": 2,',
        '  "editor.codeActionsOnSave": {',
        '    "source.fixAll.eslint": "explicit"',
        '  }',
        '}',
      ].join('\n'),
    })

    await handler({})

    const settingsJson = JSON.parse(readVsCodeSettings())
    const twClassAttributes = settingsJson['tailwindCSS.classAttributes']

    expect(Object.keys(settingsJson).length).toBe(4)
    expect(Array.isArray(twClassAttributes)).toBe(true)
    expect(twClassAttributes).toContain('class')
    expect(twClassAttributes).toContain('className')
    expect(twClassAttributes).toContain('activeClassName')
    expect(twClassAttributes).toContain('errorClassName')
    expect(twClassAttributes.length).toBe(4)
  })

  it('adds to existing settings file with existing tailwindCSS settings', async () => {
    setupDefaultProjectStructure({
      '.vscode/settings.json': [
        '{',
        '  "editor.tabSize": 2,',
        '  "editor.codeActionsOnSave": {',
        '    "source.fixAll.eslint": "explicit"',
        '  },',
        '  "tailwindCSS.emmetCompletions": true',
        '}',
      ].join('\n'),
    })

    await handler({})

    const settingsJson = JSON.parse(readVsCodeSettings())
    const twClassAttributes = settingsJson['tailwindCSS.classAttributes']

    expect(Object.keys(settingsJson).length).toBe(5)
    expect(settingsJson['tailwindCSS.emmetCompletions']).toBeTruthy()
    expect(Array.isArray(twClassAttributes)).toBe(true)
    expect(twClassAttributes).toContain('class')
    expect(twClassAttributes).toContain('className')
    expect(twClassAttributes).toContain('activeClassName')
    expect(twClassAttributes).toContain('errorClassName')
    expect(twClassAttributes.length).toBe(4)
  })

  // This is what I decided to do now. If good arguments are made to change
  // the behavior, feel free to just update the test
  it('adds to existing tailwindCSS classAttributes', async () => {
    setupDefaultProjectStructure({
      '.vscode/settings.json': [
        '{',
        '  "editor.tabSize": 2,',
        '  "editor.codeActionsOnSave": {',
        '    "source.fixAll.eslint": "explicit"',
        '  },',
        '  "tailwindCSS.emmetCompletions": true,',
        '  "tailwindCSS.classAttributes": [',
        '    "class",',
        '    "className",',
        '    "ngClass"',
        '  ]',
        '}',
      ].join('\n'),
    })

    await handler({})

    const settingsJson = JSON.parse(readVsCodeSettings())
    const twClassAttributes = settingsJson['tailwindCSS.classAttributes']

    expect(Object.keys(settingsJson).length).toBe(5)
    expect(settingsJson['tailwindCSS.emmetCompletions']).toBeTruthy()
    expect(Array.isArray(twClassAttributes)).toBe(true)
    expect(twClassAttributes).toContain('class')
    expect(twClassAttributes).toContain('className')
    expect(twClassAttributes).toContain('ngClass')
    expect(twClassAttributes).toContain('activeClassName')
    expect(twClassAttributes).toContain('errorClassName')
    expect(twClassAttributes.length).toBe(5)
  })
})

function setupDefaultProjectStructure(
  volOverride?: Record<string, string | null>,
) {
  vol.fromJSON(
    {
      'redwood.toml': '',
      'prettier.config.cjs': '',
      'web/config/': null,
      'web/src/index.css': '',
      '.vscode/settings.json': [
        '{',
        '  "editor.tabSize": 2,',
        '  "editor.codeActionsOnSave": {',
        '    "source.fixAll.eslint": "explicit"',
        '  }',
        '}',
      ].join('\n'),
      'web/vite.config.ts': [
        '/// <reference types="vitest/config" />',
        '',
        "import { defineConfig } from 'vite'",
        '',
        "import { cedar } from '@cedarjs/vite'",
        '',
        'export default defineConfig(({ mode }) => ({',
        '  plugins: [cedar({ mode })],',
        '}))',
        '',
      ].join('\n'),
    },
    APP_PATH,
  )

  if (volOverride) {
    vol.fromJSON(volOverride, APP_PATH)
  }
}

function readAppFile(filePath: string) {
  // The types are wrong for memfs.fs.readFileSync, so we cast it to string
  // See https://github.com/streamich/memfs/issues/702
  return memfsFs.readFileSync(path.join(APP_PATH, filePath), 'utf-8') as string
}

function readVsCodeSettings() {
  return memfsFs.readFileSync(
    '/redwood-app/.vscode/settings.json',
    'utf-8',
    // The types are wrong for memfs.fs.readFileSync, so we cast it to string
    // See https://github.com/streamich/memfs/issues/702
  ) as string
}
