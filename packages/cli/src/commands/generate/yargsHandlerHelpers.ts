// This file should only be asynchronously imported by the CLI (typically by
// being statically imported by a *Handler.js file that is in turn
// asynchronously imported by the CLI.)
//
// Importing this file has side effects that can't be run until after we've set
// CWD, plus importing this file statically also makes the CLI startup time
// much slower

import fs from 'node:fs'
import path from 'node:path'

import { camelCase } from 'change-case'
import { Listr } from 'listr2'
import type { ListrDefaultRendererValue, ListrTask } from 'listr2'
import pascalcase from 'pascalcase'
import type { Options, PositionalOptions } from 'yargs'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { ensurePosixPath, getConfig } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import { generateTemplate, getPaths, writeFilesTask } from '../../lib/index.js'
import { prepareForRollback } from '../../lib/rollback.js'

// TODO: Remove this import. This is only temporarily to be able to split one
// command at a time into a separate async handler
import {
  createCommand,
  createDescription,
  createBuilder,
} from './yargsCommandHelpers.js'

interface CustomOrDefaultTemplatePathArgs {
  side: 'web' | 'api' | 'scripts'
  generator: string
  templatePath: string
}

/**
 * Returns the full path to a custom generator template, if found in the app.
 * Otherwise the default Cedar template.
 */
export const customOrDefaultTemplatePath = ({
  side,
  generator,
  templatePath,
}: CustomOrDefaultTemplatePathArgs): string => {
  // Default template for this generator, e.g.
  // ./page/templates/page.tsx.template
  const defaultPath = path.join(
    import.meta.dirname,
    generator,
    'templates',
    templatePath,
  )

  // Where a custom template *might* exist, e.g.
  // /path/to/app/generatorTemplates/web/page/page.tsx.template
  const customPath = path.join(
    getPaths().generatorTemplates,
    side,
    generator,
    templatePath,
  )

  if (fs.existsSync(customPath)) {
    return customPath
  } else {
    return defaultPath
  }
}

interface TemplateForFileArgs {
  name: string
  side: 'web' | 'api' | 'scripts'
  sidePathSection?: string
  generator: string
  outputPath: string
  templatePath: string
  templateVars?: Record<string, unknown>
  [key: string]: unknown
}

// TODO: Create a function that calls templateForFile for all the files in a
// template directory instead of manually passing in each file.
export const templateForFile = async ({
  name,
  side,
  sidePathSection,
  generator,
  outputPath,
  templatePath,
  templateVars,
}: TemplateForFileArgs): Promise<[string, string]> => {
  const sideBase = getPaths()[side]
  const basePath = sidePathSection ? sideBase[sidePathSection] : sideBase

  if (typeof basePath !== 'string') {
    throw new Error(`Invalid path section: "${sidePathSection}"`)
  }

  const fullOutputPath = path.join(basePath, outputPath)
  const fullTemplatePath = customOrDefaultTemplatePath({
    generator,
    templatePath,
    side,
  })
  const mergedTemplateVars = {
    name,
    outputPath: ensurePosixPath(
      `./${path.relative(getPaths().base, fullOutputPath)}`,
    ),
    ...templateVars,
  }
  const content = await generateTemplate(fullTemplatePath, mergedTemplateVars)

  return [fullOutputPath, content]
}

interface TemplateForComponentFileArgs {
  name: string
  suffix?: string
  extension?: string
  webPathSection?: string
  apiPathSection?: string
  generator: string
  templatePath: string
  templateVars?: Record<string, unknown>
}

/**
 * Reduces boilerplate for generating an output path and content to write to
 * disk for a component.
 */
export const templateForComponentFile = async ({
  name,
  suffix = '',
  extension = '.js',
  webPathSection,
  apiPathSection,
  generator,
  templatePath,
  templateVars,
}: TemplateForComponentFileArgs): Promise<[string, string]> => {
  const side = webPathSection ? 'web' : 'api'
  const caseFn = side === 'web' ? pascalcase : camelCase
  const componentName = caseFn(name) + suffix
  const outputPath = path.join(componentName, componentName + extension)

  return templateForFile({
    name,
    suffix,
    extension,
    side,
    sidePathSection: webPathSection || apiPathSection,
    generator,
    outputPath,
    templatePath,
    templateVars,
  })
}

export const validateName = (name: string): void => {
  if (name.match(/^\W/)) {
    throw new Error(
      'The <name> argument must start with a letter, number or underscore.',
    )
  }
}

export interface HandlerArgv {
  name: string
  tests?: boolean
  stories?: boolean
  verbose?: boolean
  rollback?: boolean
  force?: boolean
  [key: string]: unknown
}

interface CreateHandlerConfig {
  componentName: string
  preTasksFn?: (argv: HandlerArgv) => HandlerArgv | Promise<HandlerArgv>
  filesFn: (argv: HandlerArgv) => Promise<Record<string, string>>
  includeAdditionalTasks?: (argv: HandlerArgv) => ListrTask[]
}

export function createHandler({
  componentName,
  preTasksFn = (argv) => argv,
  filesFn,
  includeAdditionalTasks = () => [],
}: CreateHandlerConfig) {
  return async (argv: HandlerArgv) => {
    recordTelemetryAttributes({
      command: `generate ${componentName}`,
      tests: argv.tests,
      stories: argv.stories,
      verbose: argv.verbose,
      rollback: argv.rollback,
      force: argv.force,
      // TODO: This does not cover the specific options that each generator might pass in
    })

    if (argv.tests === undefined) {
      argv.tests = getConfig().generate.tests
    }
    if (argv.stories === undefined) {
      argv.stories = getConfig().generate.stories
    }
    validateName(argv.name)

    try {
      argv = await preTasksFn(argv)

      const listrOptions = {
        exitOnError: true,
        ...(argv.verbose
          ? { renderer: 'verbose' as const }
          : { rendererOptions: { collapseSubtasks: false } }),
      }

      const tasks = new Listr<unknown, 'verbose' | ListrDefaultRendererValue>(
        [
          {
            title: `Generating ${componentName} files...`,
            task: async () => {
              const f = await filesFn(argv)
              return writeFilesTask(f, { overwriteExisting: argv.force })
            },
          },
          ...includeAdditionalTasks(argv),
        ],
        listrOptions,
      )

      if (argv.rollback && !argv.force) {
        prepareForRollback(tasks)
      }

      await tasks.run()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)

      errorTelemetry(process.argv, message)
      console.error(c.error(message))
      process.exit(errorExitCode(e))
    }
  }
}

function errorExitCode(e: unknown) {
  return typeof e === 'object' &&
    e !== null &&
    'exitCode' in e &&
    typeof e.exitCode === 'number'
    ? e.exitCode
    : 1
}

interface CreateYargsForComponentGenerationConfig {
  componentName: string
  preTasksFn?: (options: HandlerArgv) => HandlerArgv | Promise<HandlerArgv>
  /** filesFn is not used if generator implements its own `handler` */
  filesFn?: (argv: HandlerArgv) => Promise<Record<string, string>>
  optionsObj?: Record<string, Options> | (() => Record<string, Options>)
  positionalsObj?: Record<string, PositionalOptions>
  /** function that takes the options object and returns an array of listr tasks */
  includeAdditionalTasks?: (argv: HandlerArgv) => ListrTask[]
}

// TODO: Remove this function. This is only temporarily to be able to split one
// command at a time into a separate async handler
/**
 * Reduces boilerplate for creating a yargs handler that writes a
 * component/page/layout/etc to a location.
 */
export const createYargsForComponentGeneration = ({
  componentName,
  preTasksFn = (options) => options,
  /** filesFn is not used if generator implements its own `handler` */
  filesFn = async () => ({}),
  optionsObj,
  positionalsObj = {},
  /** function that takes the options object and returns an array of listr tasks */
  includeAdditionalTasks = () => [],
}: CreateYargsForComponentGenerationConfig) => {
  return {
    command: createCommand(componentName, positionalsObj),
    description: createDescription(componentName),
    builder: createBuilder({ componentName, optionsObj, positionalsObj }),
    handler: createHandler({
      componentName,
      preTasksFn,
      filesFn,
      includeAdditionalTasks,
    }),
  }
}
