import type { SignedTokenExpiresIn } from '@cedarjs/api'

import { createUploadToken } from '../../uploadToken.js'
import type { UploadTokenPayload } from '../../uploadToken.js'

export const SECRET = 'MY_VOICE_IS_MY_PASSPORT_VERIFY_ME'

export const basePayload: Omit<UploadTokenPayload, 'jti'> = {
  profile: 'avatar',
  allowedMimeTypes: ['image/png', 'text/*'],
  maxFileSize: 1024,
  maxFiles: 2,
  target: 'local',
  sub: 'user_1',
}

export function tokenFor(
  overrides: Partial<UploadTokenPayload> = {},
  expiresIn: SignedTokenExpiresIn = '5m',
) {
  return createUploadToken({
    payload: { ...basePayload, ...overrides },
    secret: SECRET,
    expiresIn,
  })
}
