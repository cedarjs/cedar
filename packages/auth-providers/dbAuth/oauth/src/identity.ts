import type { OAuthIdentityFields, OAuthUserInfo, UserType } from './types.js'
import { DEFAULT_OAUTH_IDENTITY_FIELDS } from './types.js'

export function resolveIdentityFields(
  fields: Partial<OAuthIdentityFields> | undefined,
): OAuthIdentityFields {
  return { ...DEFAULT_OAUTH_IDENTITY_FIELDS, ...fields }
}

/**
 * Thin wrapper around the identity model accessor (`db[oauthModelAccessor]`)
 * that reads/writes through the configured field names, so the rest of the
 * handler can talk about `provider`/`providerUserId`/`userId` without caring
 * how the app named its Prisma columns.
 */
export class IdentityModel {
  private accessor: any
  private fields: OAuthIdentityFields

  constructor(accessor: any, fields: OAuthIdentityFields) {
    this.accessor = accessor
    this.fields = fields
  }

  async findByProviderUserId(
    provider: string,
    providerUserId: string,
  ): Promise<UserType | null> {
    const record = await this.accessor.findFirst({
      where: {
        [this.fields.provider]: provider,
        [this.fields.providerUserId]: providerUserId,
      },
    })

    return record ?? null
  }

  async findByUserAndProvider(
    userId: unknown,
    provider: string,
  ): Promise<UserType | null> {
    const record = await this.accessor.findFirst({
      where: {
        [this.fields.userId]: userId,
        [this.fields.provider]: provider,
      },
    })

    return record ?? null
  }

  async findAllForUser(userId: unknown): Promise<UserType[]> {
    return this.accessor.findMany({
      where: { [this.fields.userId]: userId },
    })
  }

  async create(
    userId: unknown,
    provider: string,
    profile: OAuthUserInfo,
  ): Promise<UserType> {
    return this.accessor.create({
      data: {
        [this.fields.userId]: userId,
        [this.fields.provider]: provider,
        [this.fields.providerUserId]: profile.providerUserId,
        ...(profile.username
          ? { [this.fields.providerUsername]: profile.username }
          : {}),
        ...(profile.email
          ? { [this.fields.providerEmail]: profile.email }
          : {}),
      },
    })
  }

  async delete(userId: unknown, provider: string): Promise<void> {
    // `deleteMany` (rather than `delete` against the compound unique key)
    // avoids assuming Prisma's generated compound-unique field-name
    // convention for `@@unique([userId, provider])`.
    await this.accessor.deleteMany({
      where: {
        [this.fields.userId]: userId,
        [this.fields.provider]: provider,
      },
    })
  }

  userIdOf(identity: UserType): unknown {
    return identity[this.fields.userId]
  }
}
