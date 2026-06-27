import fs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'
import boxen from 'boxen'
import { config } from 'dotenv-defaults'
import execa from 'execa'
import { Listr } from 'listr2'
import prompts from 'prompts'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import {
  formatAddRootPackagesCommand,
  formatRunBinCommand,
} from '@cedarjs/cli-helpers/packageManager/display'
import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'

import { getPaths } from '../../lib/index.js'

export interface ServerlessArgs {
  stage: string
  sides: string[]
  verbose: boolean
  packOnly: boolean
  firstRun: boolean
}

interface ListrTaskDef {
  title: string
  command?: [string, string[]]
  task?: (() => Promise<void>) | (() => void)
  cwd?: string
  errorMessage?: string[]
  skip?: () => string | boolean
  enabled?: () => boolean
}

export const preRequisites = (): ListrTaskDef[] => [
  {
    title: 'Checking if Serverless framework is installed...',
    task: async () => {
      try {
        await runBin('serverless', ['--version'], { shell: true })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        throw new Error(
          `${msg}\nLooks like Serverless is not installed.\nPlease run ${formatAddRootPackagesCommand(['serverless'], true)}.`,
        )
      }
    },
  },
]

export const buildCommands = ({
  sides,
}: Pick<ServerlessArgs, 'sides'>): ListrTaskDef[] => {
  return [
    {
      title: `Building ${sides.join(' & ')}...`,
      task: async () => {
        await runBin('cedar', ['build', ...sides], { shell: true })
      },
    },
    {
      title: 'Packing Functions...',
      enabled: () => sides.includes('api'),
      task: async () => {
        // Dynamically import this function
        // because its dependencies are only installed when `cedar setup deploy serverless` is run
        const { nftPack } = await import('./packing/nft.js')

        await nftPack()
      },
    },
  ]
}

export const deployCommands = ({
  stage,
  sides,
  firstRun,
  packOnly,
}: Pick<
  ServerlessArgs,
  'stage' | 'sides' | 'firstRun' | 'packOnly'
>): ListrTaskDef[] => {
  const slsStage = stage ? ['--stage', stage] : []

  return sides.map((side) => {
    return {
      title: `Deploying ${side}....`,
      task: async () => {
        await runBin('serverless', ['deploy', ...slsStage], {
          cwd: path.join(getPaths().base, side),
          shell: true,
          stdio: 'inherit',
          cleanup: true,
        })
      },
      skip: () => {
        if (firstRun && side === 'web') {
          return 'Skipping web deploy, until environment configured'
        }

        if (packOnly) {
          return 'Finishing early due to --pack-only flag. Your Redwood project is packaged and ready to deploy'
        }

        return false
      },
    }
  })
}

const loadDotEnvForStage = (dotEnvPath: string) => {
  // Make sure we use the correct .env based on the stage
  config({
    path: dotEnvPath,
    defaults: path.join(getPaths().base, '.env.defaults'),
    encoding: 'utf8',
  })
}

export const handler = async (yargs: ServerlessArgs) => {
  recordTelemetryAttributes({
    command: 'deploy serverless',
    sides: JSON.stringify(yargs.sides),
    verbose: yargs.verbose,
    packOnly: yargs.packOnly,
    firstRun: yargs.firstRun,
  })

  const rwjsPaths = getPaths()
  const dotEnvPath = path.join(rwjsPaths.base, `.env.${yargs.stage}`)

  // Make sure .env.staging, .env.production, etc are loaded based on the --stage flag
  loadDotEnvForStage(dotEnvPath)

  const tasks = new Listr(
    [
      ...preRequisites().map(mapCommandsToListr),
      ...buildCommands(yargs).map(mapCommandsToListr),
      ...deployCommands(yargs).map(mapCommandsToListr),
    ],
    {
      exitOnError: true,
      renderer: yargs.verbose ? 'verbose' : undefined,
    },
  )
  try {
    await tasks.run()

    if (yargs.firstRun) {
      const SETUP_MARKER = ansis.bgBlue.black('First Setup ')
      console.log()

      console.log(SETUP_MARKER, c.success('Starting first setup wizard...'))

      const { stdout: slsInfo } = await runBin(
        'serverless',
        ['info', '--verbose', `--stage=${yargs.stage}`],
        {
          shell: true,
          cwd: getPaths().api.base,
        },
      )

      const apiMatch = slsInfo.match(/HttpApiUrl: (https:\/\/.*)/)
      if (!apiMatch) {
        throw new Error(
          'Could not find HttpApiUrl in serverless info output. Deploy may have failed.',
        )
      }
      const deployedApiUrl = apiMatch[1]

      console.log()
      console.log(SETUP_MARKER, `Found ${c.success(deployedApiUrl)}`)
      console.log()

      const { addDotEnv } = await prompts({
        type: 'confirm',
        name: 'addDotEnv',
        message: `Add API_URL to your .env.${yargs.stage}? This will be used if you deploy the web side from your machine`,
      })

      if (addDotEnv) {
        fs.writeFileSync(dotEnvPath, `API_URL=${deployedApiUrl}`)

        // Reload dotenv, after adding the new file
        loadDotEnvForStage(dotEnvPath)
      }

      if (yargs.sides.includes('web')) {
        console.log()
        console.log(SETUP_MARKER, 'Deploying web side with updated API_URL')

        console.log(
          SETUP_MARKER,
          'First deploys can take a good few minutes...',
        )
        console.log()

        const webDeployTasks = new Listr(
          [
            // Rebuild web with the new API_URL
            ...buildCommands({ ...yargs, sides: ['web'] }).map(
              mapCommandsToListr,
            ),
            ...deployCommands({
              ...yargs,
              sides: ['web'],
              firstRun: false,
            }).map(mapCommandsToListr),
          ],
          {
            exitOnError: true,
            renderer: yargs.verbose ? 'verbose' : undefined,
          },
        )

        // Deploy the web side now that the API_URL has been configured
        await webDeployTasks.run()

        const { stdout: webSlsInfo } = await runBin(
          'serverless',
          ['info', '--verbose', `--stage=${yargs.stage}`],
          {
            shell: true,
            cwd: getPaths().web.base,
          },
        )

        const webMatch = webSlsInfo.match(/url: (https:\/\/.*)/)
        if (!webMatch) {
          throw new Error(
            'Could not find url in serverless info output. Deploy may have failed.',
          )
        }
        const deployedWebUrl = webMatch[1]

        const message = [
          c.bold('Successful first deploy!'),
          '',
          `View your deployed site at: ${c.success(deployedWebUrl)}`,
          '',
          'You can use serverless.com CI/CD by connecting/creating an app',
          `To do this run \`${formatRunBinCommand('serverless')}\` on each of the sides, and connect your account`,
          '',
          'Find more information in our docs:',
          c.underline('https://cedarjs.com/docs/deploy#serverless'),
        ]

        console.log(
          boxen(message.join('\n'), {
            padding: { top: 0, bottom: 0, right: 1, left: 1 },
            margin: 1,
            borderColor: 'gray',
          }),
        )
      }
    }
  } catch (e) {
    console.error(c.error(e instanceof Error ? e.message : String(e)))
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}

const mapCommandsToListr = ({
  title,
  command,
  task,
  cwd,
  errorMessage,
  skip,
  enabled,
}: ListrTaskDef) => {
  return {
    title,
    task: task
      ? task
      : async () => {
          try {
            if (!command) {
              throw new Error(
                'No command or task provided to mapCommandsToListr',
              )
            }

            const executingCommand = execa(command[0], command[1], {
              cwd: cwd || getPaths().base,
              shell: true,
            })

            executingCommand.stdout?.pipe(process.stdout)

            await executingCommand
          } catch (error) {
            if (errorMessage && error instanceof Error) {
              error.message = error.message + '\n' + errorMessage.join(' ')
            }

            throw error
          }
        },
    skip,
    enabled,
  }
}
