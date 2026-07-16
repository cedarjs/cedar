import { AUTH_PROVIDER_HEADER } from '@cedarjs/api'
import type {
  MiddlewareRequest,
  MiddlewareResponse,
} from '@cedarjs/web/middleware'

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
  // We can't call .signOut() because that revokes all refresh tokens, and needs
  // the session JWT, which may be invalid.
  // Find the Supabase cookie from the request by looking for the standard
  // sb-<project-ref>-auth-token naming pattern used by @supabase/supabase-js.
  const cookieHeader = req.headers.get('cookie')
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim().split('=')[0])
    const supabaseCookie = cookies.find((name) =>
      /^sb-.*-auth-token$/.test(name),
    )
    if (supabaseCookie) {
      res.cookies.unset(supabaseCookie)
    }
  }

  // clear auth-provider cookies
  res.cookies.unset(AUTH_PROVIDER_HEADER)
}
