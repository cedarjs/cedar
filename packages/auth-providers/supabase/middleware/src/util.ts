import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'

import { AUTH_PROVIDER_HEADER } from '@cedarjs/api'
import { throwSupabaseSettingsError } from '@cedarjs/auth-supabase-api'
import type {
  MiddlewareRequest,
  MiddlewareResponse,
} from '@cedarjs/web/middleware'
/**
 * Creates Supabase Server Client used to get the session cookie (only)
 * from a given collection of auth cookies
 */
export const createSupabaseServerClient = (
  req: MiddlewareRequest,
  res: MiddlewareResponse,
) => {
  let cookieName = null

  if (!process.env.SUPABASE_URL) {
    throwSupabaseSettingsError('SUPABASE_URL')
  }

  if (!process.env.SUPABASE_KEY) {
    throwSupabaseSettingsError('SUPABASE_KEY')
  }

  const supabase = createServerClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_KEY || '',
    {
      cookies: {
        get(name: string) {
          cookieName = name
          return req.cookies.get(name)?.valueOf()
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieName = name
          req.cookies.set(name, value, options)
          res.cookies.set(name, value, options)
        },
        remove(name: string, options: CookieOptions) {
          cookieName = name
          req.cookies.set(name, '', options)
          res.cookies.set(name, '', options)
        },
      },
    },
  )

  return { cookieName, supabase }
}

/**
 * Clear the Supabase and auth cookies from the request and response
 * and clear the auth context
 */
export const clearAuthState = (
  req: MiddlewareRequest,
  res: MiddlewareResponse,
) => {
  // Clear server auth context
  req.serverAuthState.clear()

  // clear supabase cookies
  // We can't call .signOut() because that revokes all refresh tokens,
  // and needs the session JWT, which may be invalid
  const { cookieName } = createSupabaseServerClient(req, res)

  if (cookieName) {
    res.cookies.unset(cookieName)
  }

  // clear auth-provider cookies
  res.cookies.unset(AUTH_PROVIDER_HEADER)
}
