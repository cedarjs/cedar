import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ListrTask } from 'listr2'

import {
  getCreatePagesTasks,
  getCreateLayoutTasks,
  getCreateComponentsTasks,
  getCreateCellsTasks,
  getUpdateCellMocksTasks,
  getPrerenderTasks,
} from './base-tasks.mjs'
import type { CommonTaskOptions } from './base-tasks.mjs'
import {
  applyCodemod,
  fullPath,
  getCfwBin,
  getExecaOptions,
  setOutputPath,
  exec,
  updatePkgJsonScripts,
  createBuilder,
} from './util.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface WebTasksOptions {
  linkWithLatestFwBuild?: boolean
}

export async function webTasks(
  outputPath: string,
  _options?: WebTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = {
    outputPath,
    isFixture: true,
  }

  return [
    {
      title: 'Creating pages',
      task: async () => getCreatePagesTasks(options),
    },
    {
      title: 'Creating layout',
      task: async () => getCreateLayoutTasks(options),
    },
    {
      title: 'Creating components',
      task: async () => getCreateComponentsTasks(options),
    },
    {
      title: 'Creating cells',
      task: async () => getCreateCellsTasks(options),
    },
    {
      title: 'Updating cell mocks',
      task: async () => getUpdateCellMocksTasks(options),
    },
    {
      title: 'Changing routes',
      task: () => applyCodemod('routes.mjs', fullPath('web/src/Routes')),
    },
    {
      title: 'Adding Tailwind',
      task: async () => {
        await exec(
          'yarn cedar setup ui tailwindcss',
          ['--force'],
          getExecaOptions(outputPath),
        )
      },
    },
  ]
}

async function addModel(outputPath: string, schema: string) {
  const prismaPath = path.join(outputPath, 'api/db/schema.prisma')
  const current = fs.readFileSync(prismaPath, 'utf-8')
  fs.writeFileSync(prismaPath, `${current.trim()}\n\n${schema}\n`)
}

interface ApiTasksOptions {
  linkWithLatestFwBuild?: boolean
  esmProject?: boolean
}

export async function apiTasks(
  outputPath: string,
  { linkWithLatestFwBuild = false, esmProject = false }: ApiTasksOptions = {},
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = {
    outputPath,
    isFixture: true,
    linkWithLatestFwBuild,
    esmProject,
  }

  const addDbAuth = async () => {
    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: { postinstall: '' },
    })

    // Special tarball installation for fixture
    const packages = ['setup', 'api', 'web']
    for (const pkg of packages) {
      const pkgPath = path.join(
        __dirname,
        '../../',
        'packages',
        'auth-providers',
        'dbAuth',
        pkg,
      )
      await exec('yarn build:pack', [], getExecaOptions(pkgPath))
      const tgzDest = path.join(outputPath, `cedarjs-auth-dbauth-${pkg}.tgz`)
      fs.copyFileSync(
        path.join(pkgPath, `cedarjs-auth-dbauth-${pkg}.tgz`),
        tgzDest,
      )
    }

    const pkgJsonPath = path.join(outputPath, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    const oldResolutions = pkgJson.resolutions
    pkgJson.resolutions = {
      ...pkgJson.resolutions,
      '@cedarjs/auth-dbauth-setup': './cedarjs-auth-dbauth-setup.tgz',
      '@cedarjs/auth-dbauth-api': './cedarjs-auth-dbauth-api.tgz',
      '@cedarjs/auth-dbauth-web': './cedarjs-auth-dbauth-web.tgz',
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))

    await exec('yarn install', [], getExecaOptions(outputPath))
    await exec(
      'yarn cedar setup auth dbAuth --force --no-webauthn --no-createUserModel --no-generateAuthPages',
      [],
      getExecaOptions(outputPath),
    )

    if (oldResolutions) {
      pkgJson.resolutions = oldResolutions
    } else {
      delete pkgJson.resolutions
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))

    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: {
        postinstall: `yarn ${getCfwBin(outputPath)} project:copy`,
      },
    })

    await exec(
      'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
      [],
      getExecaOptions(outputPath),
    )
  }

  return [
    {
      title: 'Adding post and user model to prisma',
      task: async () => {
        const { post, user } = await import('./codemods/models.mjs')
        await addModel(outputPath, post)
        await addModel(outputPath, user)
        return exec(
          `yarn cedar prisma migrate dev --name create_post_user`,
          [],
          getExecaOptions(outputPath),
        )
      },
    },
    {
      title: 'Scaffolding post',
      task: async () => {
        await createBuilder('yarn cedar g scaffold')('post')
        await applyCodemod(
          'scenarioValueSuffix.mjs',
          fullPath('api/src/services/posts/posts.scenarios'),
        )
        await exec(
          `yarn ${getCfwBin(outputPath)} project:copy`,
          [],
          getExecaOptions(outputPath),
        )
      },
    },
    {
      title: 'Add dbAuth',
      task: async () => addDbAuth(),
    },
    {
      title: 'Add users service',
      task: async () => {
        await createBuilder('yarn cedar g sdl --no-crud', 'api')('user')
        await applyCodemod(
          'usersSdl.mjs',
          fullPath('api/src/graphql/users.sdl'),
        )
        await applyCodemod(
          'usersService.mjs',
          fullPath('api/src/services/users/users'),
        )
        await createBuilder('yarn cedar g types')()
      },
    },
    {
      title: 'Add Prerender to Routes',
      task: async () => getPrerenderTasks(options),
    },
    {
      title: 'Add context tests',
      task: () => {
        const templatePath = path.join(
          __dirname,
          'templates',
          'api',
          'context.test.ts.template',
        )
        const projectPath = path.join(
          outputPath,
          'api',
          'src',
          '__tests__',
          'context.test.ts',
        )
        fs.mkdirSync(path.dirname(projectPath), { recursive: true })
        fs.writeFileSync(projectPath, fs.readFileSync(templatePath))
      },
    },
  ]
}
