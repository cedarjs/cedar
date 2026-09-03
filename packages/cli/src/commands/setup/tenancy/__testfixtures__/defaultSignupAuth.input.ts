import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

import { DbAuthHandler } from '@cedarjs/auth-dbauth-api'
import type { DbAuthHandlerOptions, UserType } from '@cedarjs/auth-dbauth-api'

import { cookieName } from 'src/lib/auth'
import { db } from 'src/lib/db'

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
) => {
  interface UserAttributes {
    name: string
  }

  const signupOptions: DbAuthHandlerOptions<
    UserType,
    UserAttributes
  >['signup'] = {
    handler: ({
      username,
      hashedPassword,
      salt,
      userAttributes: _userAttributes,
    }) => {
      return db.user.create({
        data: {
          email: username,
          hashedPassword: hashedPassword,
          salt: salt,
          // name: userAttributes.name
        },
      })
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
