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
import fs from 'node:fs'
import path from 'node:path'

interface WebTasksOptions {
  linkWithLatestFwBuild: boolean
}

export async function webTasks(
  outputPath: string,
  { linkWithLatestFwBuild }: WebTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = { outputPath, linkWithLatestFwBuild }

  return [
    {
      title: 'Creating pages',
      task: async (_ctx, task) => task.newListr(getCreatePagesTasks(options)),
    },
    {
      title: 'Creating layout',
      task: async (_ctx, task) => task.newListr(getCreateLayoutTasks(options)),
    },
    {
      title: 'Creating components',
      task: async (_ctx, task) =>
        task.newListr(getCreateComponentsTasks(options)),
    },
    {
      title: 'Creating cells',
      task: async (_ctx, task) => task.newListr(getCreateCellsTasks(options)),
    },
    {
      title: 'Updating cell mocks',
      task: async (_ctx, task) =>
        task.newListr(getUpdateCellMocksTasks(options)),
    },
    {
      title: 'Changing routes',
      task: () => applyCodemod('routes.mjs', fullPath('web/src/Routes')),
    },
    {
      title: 'Install tailwind dependencies',
      task: () =>
        exec(
          'yarn workspace web add -D postcss postcss-loader tailwindcss autoprefixer prettier-plugin-tailwindcss@^0.5.12',
          [],
          getExecaOptions(outputPath),
        ),
      enabled: () => linkWithLatestFwBuild,
    },
    {
      title: '[link] Copy local framework files again',
      task: () =>
        exec(
          `yarn ${getCfwBin(outputPath)} project:copy`,
          [],
          getExecaOptions(outputPath),
        ),
      enabled: () => linkWithLatestFwBuild,
    },
    {
      title: 'Adding Tailwind',
      task: () => {
        return exec(
          'yarn cedar setup ui tailwindcss',
          ['--force', linkWithLatestFwBuild && '--no-install'].filter(
            Boolean,
          ) as string[],
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
  linkWithLatestFwBuild: boolean
}

export async function apiTasks(
  outputPath: string,
  { linkWithLatestFwBuild }: ApiTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = { outputPath, linkWithLatestFwBuild }

  const addDbAuth = async () => {
    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: { postinstall: '' },
    })

    const dbAuthSetupPath = path.join(
      outputPath,
      'node_modules',
      '@cedarjs',
      'auth-dbauth-setup',
    )
    fs.rmSync(dbAuthSetupPath, { recursive: true, force: true })

    await exec(
      'yarn cedar setup auth dbAuth --force --no-webauthn',
      [],
      getExecaOptions(outputPath),
    )

    updatePkgJsonScripts({
      projectPath: outputPath,
      scripts: {
        postinstall: `yarn ${getCfwBin(outputPath)} project:copy`,
      },
    })

    if (linkWithLatestFwBuild) {
      await exec(
        `yarn ${getCfwBin(outputPath)} project:copy`,
        [],
        getExecaOptions(outputPath),
      )
    }

    await exec(
      'yarn cedar g dbAuth --no-webauthn --username-label=username --password-label=password',
      [],
      getExecaOptions(outputPath),
    )

    // Codemods for SDLs
    const pathContactsSdl = path.join(
      outputPath,
      'api/src/graphql/contacts.sdl.ts',
    )
    let content = fs.readFileSync(pathContactsSdl, 'utf-8')
    content = content
      .replace(
        'createContact(input: CreateContactInput!): Contact! @requireAuth',
        `createContact(input: CreateContactInput!): Contact @skipAuth`,
      )
      .replace(
        'deleteContact(id: Int!): Contact! @requireAuth',
        'deleteContact(id: Int!): Contact! @requireAuth(roles:["ADMIN"])',
      )
    fs.writeFileSync(pathContactsSdl, content)

    const pathPostsSdl = path.join(outputPath, 'api/src/graphql/posts.sdl.ts')
    content = fs.readFileSync(pathPostsSdl, 'utf-8')
    content = content.replace(
      /posts: [Post!]! @requireAuth([^}]*)@requireAuth/,
      `posts: [Post!]! @skipAuth\n      post(id: Int!): Post @skipAuth`,
    )
    fs.writeFileSync(pathPostsSdl, content)
  }

  return [
    {
      title: 'Adding post model to prisma',
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
      task: () => addDbAuth(),
    },
    {
      title: 'Add Prerender to Routes',
      task: async (_ctx, task) => task.newListr(getPrerenderTasks(options)),
    },
  ]
}

export async function streamingTasks(outputPath: string): Promise<ListrTask[]> {
  return [
    {
      title: 'Creating Delayed suspense delayed page',
      task: async () => {
        await createBuilder('yarn cedar g page')('delayed')
        return applyCodemod(
          'delayedPage.mjs',
          fullPath('web/src/pages/DelayedPage/DelayedPage'),
        )
      },
    },
    {
      title: 'Enable streaming-ssr experiment',
      task: async () => {
        await createBuilder('yarn cedar experimental setup-streaming-ssr')(
          '--force',
        )
      },
    },
  ]
}

export async function fragmentsTasks(outputPath: string): Promise<ListrTask[]> {
  const options: CommonTaskOptions = { outputPath }
  return [
    {
      title: 'Enable fragments',
      task: async () => {
        const tomlPath = path.join(outputPath, 'redwood.toml')
        const content = fs.readFileSync(tomlPath, 'utf-8')
        fs.writeFileSync(
          tomlPath,
          content + '\n[graphql]\n  fragments = true\n',
        )
      },
    },
    {
      title: 'Adding produce and stall models',
      task: async () => {
        const { produce, stall } = await import('./codemods/models.mjs')
        await addModel(outputPath, produce)
        await addModel(outputPath, stall)
        return exec(
          'yarn cedar prisma migrate dev --name create_produce_stall',
          [],
          getExecaOptions(outputPath),
        )
      },
    },
  ]
}
