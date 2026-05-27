import fs from 'node:fs'
import path from 'node:path'

import * as parser from '@babel/parser'
import * as t from '@babel/types'
import execa from 'execa'
import { Listr } from 'listr2'
import * as recast from 'recast'

import { getConfigPath, getConfig } from '@cedarjs/project-config'

import { getPaths, writeFilesTask } from '../../../../lib/index.js'

export const updateApiURLTask = (apiUrl) => {
  const configTomlPath = getConfigPath()
  const configFileName = path.basename(configTomlPath)

  return {
    title: `Updating API URL in ${configFileName}...`,
    task: () => {
      const tomlContent = fs.readFileSync(configTomlPath, 'utf-8')
      let newToml = tomlContent

      if (tomlContent.match(/apiUrl/)) {
        newToml = newToml.replace(/apiUrl.*/g, `apiUrl = "${apiUrl}"`)
      } else if (tomlContent.match(/\[web\]/)) {
        newToml = newToml.replace(/\[web\]/, `[web]\n  apiUrl = "${apiUrl}"`)
      } else {
        newToml += `[web]\n  apiUrl = "${apiUrl}"`
      }

      fs.writeFileSync(configTomlPath, newToml)
    },
  }
}

export function getUserApiUrl() {
  return getConfig().web.apiUrl
}

/**
 * Use this to create checks prior to running setup commands
 * with a better error output
 *
 * @example preRequisiteCheckTask([
    {
      title: 'Checking if xxx is installed...',
      command: ['xxx', ['--version']],
      errorMessage: [
        'Looks like xxx.',
        'Please follow the steps...',
      ],
    },
  ])
 */
export const preRequisiteCheckTask = (preRequisites) => {
  return {
    title: 'Checking pre-requisites',
    task: () =>
      new Listr(
        preRequisites.map((preReq) => {
          return {
            title: preReq.title,
            task: async () => {
              try {
                await execa(...preReq.command)
              } catch (error) {
                error.message = error.message + '\n' + preReq.errorMessage
                throw error
              }
            },
          }
        }),
      ),
  }
}

/**
 *
 * Use this to add files to a users project
 *
 * @example
 * addFilesTask(
 *  files: [ { path: path.join(getPaths().base, 'netlify.toml'), content: NETLIFY_TOML }],
 * )
 */
export const addFilesTask = ({
  files,
  force = false,
  title = 'Adding config',
}) => {
  return {
    title: `${title}...`,
    task: () => {
      let fileNameToContentMap = {}
      files.forEach((fileData) => {
        fileNameToContentMap[fileData.path] = fileData.content
      })
      return writeFilesTask(fileNameToContentMap, { overwriteExisting: force })
    },
  }
}

export const verifyUDSetupTask = () => {
  return {
    title: 'Checking if Universal Deploy is set up...',
    task: () => {
      const paths = getPaths()
      const viteConfigTs = path.join(paths.web.base, 'vite.config.ts')
      const viteConfigJs = path.join(paths.web.base, 'vite.config.js')
      const viteConfigPath = fs.existsSync(viteConfigTs)
        ? viteConfigTs
        : viteConfigJs

      if (!fs.existsSync(viteConfigPath)) {
        throw new Error('Vite config file not found')
      }

      const content = fs.readFileSync(viteConfigPath, 'utf-8')

      if (!content.includes('cedarUniversalDeployPlugin')) {
        throw new Error(
          'Universal Deploy is not set up. Please run `yarn cedar setup deploy universal-deploy` first.',
        )
      }
    },
  }
}

/**
 * Converts a 1-based line/column position to a character index.
 */
function posToIndex(str, line, column) {
  const lines = str.split('\n')
  let index = 0
  for (let i = 0; i < line - 1; i++) {
    index += lines[i].length + 1
  }
  return index + column
}

/**
 * Unwraps the config object from a `defineConfig(...)` call argument.
 *
 * Handles both direct object and arrow/function wrappers:
 *   defineConfig({...})                    → ObjectExpression
 *   defineConfig(({ mode }) => ({...}))    → ObjectExpression   (arrow, implicit return)
 *   defineConfig(() => { return {...} })   → ObjectExpression   (arrow, explicit return)
 *   defineConfig(function() { return {} }) → ObjectExpression   (function expression)
 *
 * @param {object} arg - A babel AST node.
 * @returns The inner ObjectExpression, or `null` if not found.
 */
function resolveConfigObject(arg) {
  if (t.isObjectExpression(arg)) {
    return arg
  }

  if (t.isArrowFunctionExpression(arg)) {
    // Implicit return: ({...})
    if (t.isObjectExpression(arg.body)) {
      return arg.body
    }
    // Block body with explicit return: { return {...} }
    if (t.isBlockStatement(arg.body)) {
      const returnStmt = arg.body.body.find((s) => t.isReturnStatement(s))
      if (returnStmt && t.isObjectExpression(returnStmt.argument)) {
        return returnStmt.argument
      }
    }
    return null
  }

  if (t.isFunctionExpression(arg)) {
    if (t.isBlockStatement(arg.body)) {
      const returnStmt = arg.body.body.find((s) => t.isReturnStatement(s))
      if (returnStmt && t.isObjectExpression(returnStmt.argument)) {
        return returnStmt.argument
      }
    }
    return null
  }

  return null
}

/**
 * Inserts plugin call expressions before `cedar()` in the `plugins` array
 * of `defineConfig({...})` inside a vite config file.
 *
 * Uses recast only for position-finding, then does text-level insertion to
 * preserve all original formatting, comments, and blank lines.
 *
 * @param {string}        content       - The full file content.
 * @param {string[]}      pluginCodes   - Source strings for each plugin call
 *                                        (e.g. `["netlifyCompat()"]`).
 * @returns Modified source string, or `null` if `cedar()` was not found.
 */
export function insertPluginsBeforeCedar({ content, pluginCodes }) {
  const ast = recast.parse(content, {
    parser: {
      parse(source) {
        return parser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        })
      },
    },
  })

  const defaultExport = ast.program.body.find(
    (node) =>
      t.isExportDefaultDeclaration(node) &&
      t.isCallExpression(node.declaration) &&
      t.isIdentifier(node.declaration.callee) &&
      node.declaration.callee.name === 'defineConfig',
  )

  if (!defaultExport) {
    return null
  }

  const configArg = resolveConfigObject(defaultExport.declaration.arguments[0])
  if (!configArg) {
    return null
  }

  const pluginsProp = configArg.properties.find(
    (prop) =>
      t.isObjectProperty(prop) &&
      t.isIdentifier(prop.key) &&
      prop.key.name === 'plugins' &&
      t.isArrayExpression(prop.value),
  )

  if (!pluginsProp) {
    return null
  }

  const elements = pluginsProp.value.elements
  const cedarIndex = elements.findIndex(
    (el) =>
      t.isCallExpression(el) &&
      t.isIdentifier(el.callee) &&
      el.callee.name === 'cedar',
  )

  if (cedarIndex === -1) {
    return null
  }

  const cedarNode = elements[cedarIndex]

  // Check if the array is inline (all elements on the same line as [)
  const arrayNode = pluginsProp.value
  const isInline = cedarNode.loc.start.line === arrayNode.loc.start.line

  if (isInline) {
    const startPos = posToIndex(
      content,
      arrayNode.loc.start.line,
      arrayNode.loc.start.column,
    )
    const endPos = posToIndex(
      content,
      arrayNode.loc.end.line,
      arrayNode.loc.end.column,
    )

    const precedingText = content.slice(0, startPos)
    const followingText = content.slice(endPos)

    const existingCodes = elements.map((el) =>
      content.slice(
        posToIndex(content, el.loc.start.line, el.loc.start.column),
        posToIndex(content, el.loc.end.line, el.loc.end.column),
      ),
    )

    const lines = content.split('\n')
    const pluginsLine = pluginsProp.loc.start.line
    const pluginsIndent = lines[pluginsLine - 1].match(/^\s*/)[0]
    const elemIndent = pluginsIndent + '  '

    const allCodes = [...existingCodes]
    allCodes.splice(cedarIndex, 0, ...pluginCodes)

    const multiline = [
      '[',
      ...allCodes.map((code) => `${elemIndent}${code},`),
      `${pluginsIndent}]`,
    ].join('\n')

    return precedingText + multiline + followingText
  }

  // Multiline: insert at start of cedar()'s line (after the preceding \n)
  const cedarLine = cedarNode.loc.start.line
  const insertPos = posToIndex(content, cedarLine, 0)
  const lines = content.split('\n')
  const indent = lines[cedarLine - 1].match(/^\s*/)[0]
  const insertion = pluginCodes.map((code) => `${indent}${code},\n`).join('')

  return content.slice(0, insertPos) + insertion + content.slice(insertPos)
}

export const addToGitIgnoreTask = ({ paths }) => {
  return {
    title: 'Updating .gitignore...',
    skip: () => {
      if (!fs.existsSync(path.resolve(getPaths().base, '.gitignore'))) {
        return 'No gitignore present, skipping.'
      }
    },
    task: async (_ctx, task) => {
      const gitIgnore = path.resolve(getPaths().base, '.gitignore')
      const content = fs.readFileSync(gitIgnore).toString()

      if (paths.every((item) => content.includes(item))) {
        task.skip('.gitignore already includes the additions.')
      }

      fs.appendFileSync(gitIgnore, ['\n', '# Deployment', ...paths].join('\n'))
    },
  }
}

export const addToDotEnvTask = ({ lines }) => {
  return {
    title: 'Updating .env...',
    skip: () => {
      if (!fs.existsSync(path.resolve(getPaths().base, '.env'))) {
        return 'No .env present, skipping.'
      }
    },
    task: async (_ctx, task) => {
      const env = path.resolve(getPaths().base, '.env')
      const content = fs.readFileSync(env).toString()

      if (lines.every((line) => content.includes(line.split('=')[0]))) {
        task.skip('.env already includes the additions.')
      }

      fs.appendFileSync(env, lines.join('\n'))
    },
  }
}
