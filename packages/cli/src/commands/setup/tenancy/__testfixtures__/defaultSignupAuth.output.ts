import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

import { DbAuthHandler } from '@cedarjs/auth-dbauth-api'
import type { DbAuthHandlerOptions, UserType } from '@cedarjs/auth-dbauth-api'

import { cookieName } from 'src/lib/auth'
import { db } from 'src/lib/db'

import { ensureDefaultOrganization } from 'src/services/organizations/organizations'

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
) => {
  interface UserAttributes {
    name: string
    invitationToken?: string
  }

  const signupOptions: DbAuthHandlerOptions<
    UserType,
    UserAttributes
  >['signup'] = {
    handler: async ({ username, hashedPassword, salt, userAttributes }) => {
      const user = await db.user.create({
        data: {
          email: username,
          hashedPassword: hashedPassword,
          salt: salt,
          // name: userAttributes.name
        },
      })

      await ensureDefaultOrganization({
        currentUser: {
          id: user.id,
          memberships: [],
        },

        invitationToken: userAttributes.invitationToken,
      })

      return user
    },

    passwordValidation: (_password) => {
      return true
    },

    errors: {
      fieldMissing: '${field} is required',
      usernameTaken: 'Username `${username}` already in use',
    },
  }

  const authHandler = new DbAuthHandler(event, context, {
    db: db,
    authModelAccessor: 'user',
    authFields: {
      id: 'id',
      username: 'email',
      hashedPassword: 'hashedPassword',
      salt: 'salt',
      resetToken: 'resetToken',
      resetTokenExpiresAt: 'resetTokenExpiresAt',
    },
    allowedUserFields: ['id', 'email'],
    cookie: {
      attributes: {
        HttpOnly: true,
        Path: '/',
        SameSite: 'Lax',
        Secure: process.env.NODE_ENV !== 'development',
      },
      name: cookieName,
    },
    signup: signupOptions,
  })

  return await authHandler.invoke()
}
