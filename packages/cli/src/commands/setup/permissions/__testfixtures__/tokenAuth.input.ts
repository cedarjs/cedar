import type { Decoded } from '@cedarjs/api'

export const getCurrentUser = async (decoded: Decoded) => {
  if (!decoded) {
    return null
  }

  const roles = decoded['https://example.com/roles']
  const findRole = () => {
    return 'nested'
  }

  if (typeof roles === 'string' || Array.isArray(roles)) {
    return { ...decoded, roles, role: findRole() }
  }

  return { ...decoded }
}
