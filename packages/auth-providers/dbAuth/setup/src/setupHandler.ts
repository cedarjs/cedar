import fs from 'node:fs'
import path from 'node:path'

import prompts from 'prompts'

import { getGraphqlPath, standardAuthHandler } from '@cedarjs/cli-helpers'

import {
  apiPackages as oauthApiPackages,
  configureOAuthProvidersTask,
  createUserModelTask as oauthCreateUserModelTask,
  envVarNotes as oauthEnvVarNotes,
  noteGenerate as oauthNoteGenerate,
  notes as oauthNotes,
  parseOAuthProviders,
  webAuthnCreateUserModelTask as webAuthnOauthCreateUserModelTask,
  webAuthnOauthNotes,
} from './oauth.setupData.js'
import type { Args } from './setup.js'
import {
  notes,
  noteGenerate,
  notesCreatedUserModel,
  notePrivateSet,
  extraTask,
  createUserModelTask,
} from './setupData.js'
import {
  generateAuthPagesTask,
  getModelNames,
  hasAuthPages,
  hasModel,
} from './shared.js'
import {
  notes as webAuthnNotes,
  noteGenerate as webAuthnNoteGenerate,
  extraTask as webAuthnExtraTask,
  webPackages as webAuthnWebPackages,
  apiPackages as webAuthnApiPackages,
  createUserModelTask as webAuthnCreateUserModelTask,
} from './webAuthn.setupData.js'

export async function handler({
  webauthn,
  oauth,
  createUserModel,
  generateAuthPages,
  force: forceArg,
}: Args) {
  const { version } = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, '../package.json'),
      'utf-8',
    ),
  )

  const webAuthn = await shouldIncludeWebAuthn(webauthn)
  const oauthProviders = parseOAuthProviders(oauth)
  const includeOAuth = oauthProviders.length > 0
  const createDbUserModel = await shouldCreateUserModel(createUserModel)
  const generateDbAuthPages = await shouldGenerateDbAuthPages(generateAuthPages)

  const oneMoreThing: string[] = []

  if (webAuthn && includeOAuth) {
    if (createDbUserModel) {
      oneMoreThing.push(...notesCreatedUserModel)
    } else {
      oneMoreThing.push(...webAuthnOauthNotes())
    }
    oneMoreThing.push(...oauthEnvVarNotes(oauthProviders))

    if (!generateDbAuthPages) {
      oneMoreThing.push(...webAuthnNoteGenerate)
    }
  } else if (webAuthn) {
    if (createDbUserModel) {
      oneMoreThing.push(...notesCreatedUserModel)
    } else {
      oneMoreThing.push(...webAuthnNotes)
    }

    if (!generateDbAuthPages) {
      oneMoreThing.push(...webAuthnNoteGenerate)
    }
  } else if (includeOAuth) {
    if (createDbUserModel) {
      oneMoreThing.push(...notesCreatedUserModel)
    } else {
      oneMoreThing.push(...oauthNotes())
    }
    oneMoreThing.push(...oauthEnvVarNotes(oauthProviders))

    if (!generateDbAuthPages) {
      oneMoreThing.push(...oauthNoteGenerate)
    }
  } else {
    if (createDbUserModel) {
      oneMoreThing.push(...notesCreatedUserModel)
    } else {
      oneMoreThing.push(...notes)
    }

    if (!generateDbAuthPages) {
      oneMoreThing.push(...noteGenerate)
    }
  }

  oneMoreThing.push(...notePrivateSet)

  let createDbUserModelTask: typeof createUserModelTask | undefined = undefined

  if (createDbUserModel) {
    if (webAuthn && includeOAuth) {
      createDbUserModelTask = webAuthnOauthCreateUserModelTask
    } else if (webAuthn) {
      createDbUserModelTask = webAuthnCreateUserModelTask
    } else if (includeOAuth) {
      createDbUserModelTask = oauthCreateUserModelTask
    } else {
      createDbUserModelTask = createUserModelTask
    }
  }

  await standardAuthHandler({
    basedir: import.meta.dirname,
    forceArg,
    provider: 'dbAuth',
    authDecoderImport:
      "import { createAuthDecoder } from '@cedarjs/auth-dbauth-api'",
    webAuthn,
    oauth: includeOAuth,
    webPackages: [
      `@cedarjs/auth-dbauth-web@${version}`,
      ...(webAuthn ? webAuthnWebPackages : []),
    ],
    apiPackages: [
      `@cedarjs/auth-dbauth-api@${version}`,
      ...(webAuthn ? webAuthnApiPackages : []),
      ...(includeOAuth
        ? [`@cedarjs/auth-dbauth-oauth@${version}`, ...oauthApiPackages]
        : []),
    ],
    extraTasks: [
      webAuthn ? webAuthnExtraTask : extraTask,
      createDbUserModelTask,
      createAuthDecoderFunction,
      includeOAuth ? configureOAuthProvidersTask(oauthProviders) : undefined,
      generateDbAuthPages
        ? generateAuthPagesTask(createDbUserModel)
        : undefined,
    ],
    notes: oneMoreThing,
  })
}

/**
 * Prompt the user (unless already specified on the command line) if they want
 * to enable WebAuthn support
 */
async function shouldIncludeWebAuthn(webauthn: boolean | null) {
  if (webauthn === null) {
    const webAuthnResponse = await prompts({
      type: 'confirm',
      name: 'answer',
      message: `Enable WebAuthn support (TouchID/FaceID)? See https://cedarjs.com/docs/auth/dbAuth#webAuthn`,
      initial: false,
    })

    return webAuthnResponse.answer
  }

  return webauthn
}

/**
 * Prompt the user (unless already specified on the command line) if they want
 * to create a User model in their Prisma schema
 */
async function shouldCreateUserModel(createUserModel: boolean | null) {
  const hasUserModel = await hasModel('User')

  const modelNames = await getModelNames()
  const isNewProject =
    modelNames.length === 1 && modelNames[0] === 'UserExample'

  if (isNewProject) {
    return true
  }

  if (createUserModel === null && !hasUserModel) {
    const createModelResponse = await prompts({
      type: 'confirm',
      name: 'answer',
      message: 'Create User model?',
      initial: false,
    })

    return createModelResponse.answer
  }

  return createUserModel
}

/**
 * Prompt the user (unless already specified on the command line) if they want
 * to generate auth pages. Also checks to make sure auth pages don't already
 * exist before prompting.
 */
async function shouldGenerateDbAuthPages(generateAuthPages: boolean | null) {
  if (generateAuthPages === null && !hasAuthPages()) {
    const generateAuthPagesResponse = await prompts({
      type: 'confirm',
      name: 'answer',
      message: 'Generate auth pages (login, signup, forgotten password, etc)?',
      initial: false,
    })

    return generateAuthPagesResponse.answer
  }

  return generateAuthPages
}

export const createAuthDecoderFunction = {
  title: 'Create auth decoder function',
  task: () => {
    const graphqlPath = getGraphqlPath()

    if (!graphqlPath) {
      throw new Error('Could not find your graphql file path')
    }

    const authDecoderCreation =
      'const authDecoder = createAuthDecoder(cookieName)'

    const content = fs.readFileSync(graphqlPath, 'utf-8')

    let newContent = content.replace(
      'import { getCurrentUser } from',
      'import { cookieName, getCurrentUser } from',
    )

    const authDecoderCreationRegexp = new RegExp(
      '^' + escapeRegExp(authDecoderCreation),
      'm',
    )

    if (!authDecoderCreationRegexp.test(newContent)) {
      newContent = newContent.replace(
        'export const handler = createGraphQLHandler({',
        authDecoderCreation +
          '\n\n' +
          'export const handler = createGraphQLHandler({',
      )
    }

    if (!newContent.includes('import { cookieName')) {
      throw new Error('Failed to import cookieName')
    }

    fs.writeFileSync(graphqlPath, newContent)
  },
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}
