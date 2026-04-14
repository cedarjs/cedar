# gqlorm schema-aware fields and types: remaining work

- [x] Generate `.cedar/types/includes/web-gqlorm-models.d.ts` from Prisma DMMF as part of gqlorm artifact generation
  - [x] Emit `GqlormScalar.*` interfaces containing only visible scalar/enum fields
  - [x] Augment `@cedarjs/gqlorm/types/orm` with `GqlormTypeMap.models`
  - [x] Use the planned DMMF → TypeScript type mapping for generated scalar field types
  - [x] Include auto-hidden sensitive fields by omission only

- [x] Wire generated scalar model types into gqlorm type inference
  - [x] Add `ScalarTypeForModel<TModel>` in `packages/gqlorm/src/types/orm.ts`
  - [x] Update framework db typing so model delegates can resolve to generated scalar model types
  - [x] Verify `useLiveQuery((db) => db.post.findMany())` infers visible scalar return types without explicit generics

- [x] Expand sensitivity heuristic coverage to match the plan
  - [x] Add `key` and any intended common variants to the sensitive-name matcher
  - [x] Keep `@gqlorm show` / `@gqlorm hide` precedence unchanged

- [x] Handle additional internal migration model names
  - [x] Skip `Cedar_DataMigration` as well as `RW_DataMigration`

- [x] Run gqlorm frontend artifact generation independently of the experimental backend flag
  - [x] Generate frontend schema/types whenever Prisma models are present, even if backend gqlorm is disabled
  - [x] Keep backend resolver generation gated behind `experimental.gqlorm.enabled`

- [x] Re-run gqlorm artifact generation when `api/db/schema.prisma` changes during watch mode
  - [x] Add a watcher path for the Prisma schema file
  - [x] Regenerate gqlorm artifacts without requiring unrelated source changes

- [x] Extend project config typing for planned gqlorm backend auth conventions
  - [x] Add `organizationModel`
  - [x] Add `membershipModel`
  - [x] Add `membershipUserField`
  - [x] Add `membershipOrganizationField`

- [ ] Implement the planned backend auth model for auto-generated resolvers
  - [ ] Require auth in generated gqlorm resolvers
  - [ ] Scope models with `userId` to the current user
  - [ ] Scope models with `organizationId` through the configured membership model
  - [ ] Enforce equivalent checks for single-record resolvers
  - [ ] Log a startup/codegen notice when organization scoping cannot be applied because membership config/model is unavailable

- [ ] Add/adjust tests for the remaining planned behavior
  - [x] Test generated `web-gqlorm-models.d.ts` output
  - [x] Test scalar type inference through gqlorm delegates and `useLiveQuery`
  - [ ] Test watch-mode regeneration on Prisma schema changes
  - [x] Test config typing/defaults for gqlorm membership settings
  - [ ] Test backend auth scoping behavior
