import { useCallback } from 'react'

import type { CurrentUser } from '../AuthContext.js'
import type { AuthImplementation } from '../AuthImplementation.js'

import { useToken } from './useToken.js'

export const useCurrentUser = (authImplementation: AuthImplementation) => {
  const getToken = useToken(authImplementation)

  return useCallback(async (): Promise<CurrentUser> => {
    // Always get a fresh token, rather than use the one in state
    const token = await getToken()
    const response = await globalThis.fetch(globalThis.RWJS_API_GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'auth-provider': authImplementation.type,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: 'query __CEDAR__AUTH_GET_CURRENT_USER { cedar { currentUser } }',
      }),
    })

    if (response.ok) {
      const { data } = await response.json()
      return data?.cedar?.currentUser ?? null
    } else {
      throw new Error(
        `Could not fetch current user: ${response.statusText} (${response.status})`,
      )
    }
  }, [authImplementation, getToken])
}
