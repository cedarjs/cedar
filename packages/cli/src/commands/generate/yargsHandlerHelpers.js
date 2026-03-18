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
import pascalcase from 'pascalcase'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { ensurePosixPath, getConfig } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../lib/colors.js'
import { generateTemplate, getPaths, writeFilesTask } from '../../lib/index.js'
import { prepareForRollback } from '../../lib/rollback.js'

// TODO: Remove this import. This is only temporarily to be able to split one
// command at a time into a separate async handler
import {
  createCommand,
  createDescription,
  createBuilder,
} from './yargsCommandHelpers.js'

/**
 * Returns the full path to a custom generator template, if found in the app.
 * Otherwise the default Cedar template.
 */
export const customOrDefaultTemplatePath = ({
  side,
  generator,
  templatePath,
}) => {
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

  // Old, deprecated, custom template path, e.g.
  // /path/to/app/web/generators/page/page.tsx.template
  const deprecatedCustomPath = getPaths()[side].generators
    ? path.join(getPaths()[side].generators, generator, templatePath)
    : undefined

  if (fs.existsSync(customPath)) {
    return customPath
  } else if (deprecatedCustomPath && fs.existsSync(deprecatedCustomPath)) {
    console.log(
      `Having generator templates in ${getPaths()[side].generators} has been ` +
        `deprecated. Please move them to ${getPaths().generatorTemplates}.`,
    )
    return deprecatedCustomPath
  } else {
    return defaultPath
  }
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
}) => {
  const basePath = sidePathSection
    ? getPaths()[side][sidePathSection]
    : getPaths()[side]
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
}) => {
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

export const validateName = (name) => {
  if (name.match(/^\W/)) {
    throw new Error(
      'The <name> argument must start with a letter, number or underscore.',
    )
  }
}

export function createHandler({
  componentName,
  preTasksFn = (argv) => argv,
  filesFn,
  includeAdditionalTasks = () => [],
}) {
  return async (argv) => {
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

      const tasks = new Listr(
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
        {
          rendererOptions: { collapseSubtasks: false },
          exitOnError: true,
          renderer: argv.verbose && 'verbose',
        },
      )

      if (argv.rollback && !argv.force) {
        prepareForRollback(tasks)
      }
      await tasks.run()
    } catch (e) {
      errorTelemetry(process.argv, e.message)
      console.error(c.error(e.message))
      process.exit(e?.exitCode || 1)
    }
  }
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
  filesFn = () => ({}),
  optionsObj,
  positionalsObj = {},
  /** function that takes the options object and returns an array of listr tasks */
  includeAdditionalTasks = () => [],
}) => {
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
