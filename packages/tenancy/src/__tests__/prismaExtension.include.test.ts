import { beforeEach, describe, expect, it } from 'vitest'

import { db, rawDb, resetTestDb } from './helpers/testDb.js'

describe('createTenancyExtension - nested include/select scoping', () => {
  beforeEach(async () => {
    await resetTestDb()

    // A second project in `org1`, plus tasks in both organizations, so a
    // list relation reached from a global model has something to leak if
    // it isn't scoped.
    await db.$withoutTenant().project.create({
      data: { id: 'p1b', organizationId: 'org1', name: 'Project One B' },
    })
    await db.$withoutTenant().task.create({
      data: {
        id: 't1',
        organizationId: 'org1',
        projectId: 'p1',
        title: 'Org1 task',
      },
    })
    await db.$withoutTenant().task.create({
      data: {
        id: 't2',
        organizationId: 'org2',
        projectId: 'p2',
        title: 'Org2 task',
      },
    })
    await db.$withoutTenant().tag.update({
      where: { id: 'tag1' },
      data: { projects: { connect: { id: 'p2' } } },
    })
  })

  it('scopes a list relation reached from a global model (Organization -> projects)', async () => {
    // `db` is scoped to `org1`. Reading `org2` through it (Organization
    // itself is global, so this succeeds) must not surface `org2`'s own
    // project through the `projects` relation.
    const org2 = await db.organization.findUniqueOrThrow({
      where: { id: 'org2' },
      include: { projects: true },
    })
    expect(org2.projects).toEqual([])

    const org1 = await db.organization.findUniqueOrThrow({
      where: { id: 'org1' },
      include: { projects: true },
    })
    expect(org1.projects.map((p) => p.id).sort()).toEqual(['p1', 'p1b'])
  })

  it('scopes a list relation reached from a many-to-many global model (Tag -> projects)', async () => {
    // `tag1` is connected to both `p1` (org1) and `p2` (org2). Reading it
    // through the org1-scoped client must only surface `p1`.
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { projects: true },
    })
    expect(tag.projects.map((p) => p.id)).toEqual(['p1'])
  })

  it('scopes a list relation nested two levels deep (Tag -> projects -> tasks)', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { projects: { include: { tasks: true } } },
    })
    const allTasks = tag.projects.flatMap((p) => p.tasks)
    expect(allTasks.map((t) => t.id)).toEqual(['t1'])
  })

  it('scopes a list relation given as an object (with its own orderBy)', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { projects: { orderBy: { id: 'asc' } } },
    })
    expect(tag.projects.map((p) => p.id)).toEqual(['p1'])
  })

  it('scopes select the same way as include', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      select: { id: true, projects: { select: { id: true } } },
    })
    expect(tag.projects.map((p) => p.id)).toEqual(['p1'])
  })

  it('scopes a _count.select on a tenant-owned relation', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { _count: { select: { projects: true } } },
    })
    expect(tag._count.projects).toBe(1)
  })

  it('does not add a where to a to-one relation include', async () => {
    // `Task.project` is a to-one relation to a tenant-owned model; Prisma
    // would reject a `where` there, so this must not throw.
    const task = await db.task.findUniqueOrThrow({
      where: { id: 't1' },
      include: { project: true },
    })
    expect(task.project.id).toBe('p1')
  })

  it('still scopes a list relation declared after a braced default and a braced comment on the same model', async () => {
    // `Organization.config` (`@default("{}")`) and `Organization.slug`
    // (trailing `// ... "{acme}"` comment) both declare a `}` in unit-test-
    // schema.prisma before `Organization.projects`, the list relation this
    // asserts is still scoped. A brace-truncating parser reads either one as
    // the model's closing brace, drops `projects` from the parsed field map,
    // and leaves it unscoped (see `parseListFieldsFromSchema.test.ts` for a
    // parser-level version of this same case).
    const org2 = await db.organization.findUniqueOrThrow({
      where: { id: 'org2' },
      include: { projects: true },
    })
    expect(org2.projects).toEqual([])
  })

  it('still scopes a genuine list relation after the schema-driven cardinality change', async () => {
    // `Project.tasks` is an explicit one-to-many, and `Tag.projects` is an
    // implicit many-to-many; both must still get a `where` merged in now
    // that cardinality comes from the parsed schema instead of the
    // `<field>Id` naming heuristic.
    const project = await db.project.findUniqueOrThrow({
      where: { id: 'p1' },
      include: { tasks: true },
    })
    expect(project.tasks.map((t) => t.id)).toEqual(['t1'])

    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { projects: true },
    })
    expect(tag.projects.map((p) => p.id)).toEqual(['p1'])
  })
})

describe('createTenancyExtension - cardinality shapes the naming heuristic gets wrong', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('does not add a where to a to-one relation whose foreign key is not named <field>Id', async () => {
    // `Document.owner` is a to-one relation to the global `Membership`
    // model, with foreign key `ownerMembershipId` rather than `ownerId`.
    // The naming heuristic gets its cardinality wrong here too, but that
    // alone can't surface as a bug: a relation into a global model is
    // never scoped regardless of cardinality (see the `shouldScope`
    // check), so this asserts the query still succeeds, not that scoping
    // was skipped.
    await db.document.create({
      data: { id: 'doc1', title: 'Doc One', ownerMembershipId: 'membership1' },
    })

    const doc = await db.document.findUniqueOrThrow({
      where: { id: 'doc1' },
      include: { owner: true },
    })
    expect(doc.owner?.id).toBe('membership1')
  })

  // Both tests below give the to-one relation a related row in *another*
  // organization than the one `db` is scoped to — a data-integrity
  // violation that can't happen through the extension itself (`connect`'s
  // target is always tenant-checked), only through `$withoutTenant()`, so
  // it's deliberately created that way here to make the two cardinalities
  // observably different: Prisma silently returns `null` for an optional
  // to-one relation's include when a `where` is merged in and doesn't
  // match, rather than rejecting the `where` outright, so a same-tenant
  // fixture would pass whether or not scoping was (wrongly) applied. A
  // cross-tenant fixture is the only way to tell the two apart.

  it('does not add a where to a to-one relation into another tenant-owned model, when its foreign key is not named <field>Id', async () => {
    // `Document.project` is a to-one relation to the *tenant-owned*
    // `Project` model, with foreign key `belongsToProjectId` rather than
    // `projectId`. The naming heuristic reads "no `projectId` sibling on
    // Document" as "`project` must be a list", and would merge
    // `where: { organizationId: 'org1' }` into the include — which
    // `p2` (in `org2`) doesn't match, so the naming heuristic would return
    // `project: null` here instead of the actual row.
    await db.$withoutTenant().document.create({
      data: {
        id: 'doc2',
        organizationId: 'org1',
        title: 'Doc Two',
        belongsToProjectId: 'p2',
      },
    })

    const doc = await db.document.findUniqueOrThrow({
      where: { id: 'doc2' },
      include: { project: true },
    })
    expect(doc.project?.id).toBe('p2')
  })

  it('does not add a where to the non-owning side of a one-to-one relation between two tenant-owned models', async () => {
    // `Project.settings` is the non-owning side of a one-to-one relation:
    // the foreign key (`projectId`) lives on `ProjectSettings`, so
    // `Project` has no `settingsId` sibling field at all. The naming
    // heuristic reads "no sibling foreign key" as "must be a list", and
    // would merge `where: { organizationId: 'org1' }` into the include —
    // which `ps1` (in `org2`) doesn't match, so the naming heuristic would
    // return `settings: null` here instead of the actual row.
    await db.$withoutTenant().projectSettings.create({
      data: {
        id: 'ps1',
        organizationId: 'org2',
        projectId: 'p1',
        theme: 'dark',
      },
    })

    const project = await db.project.findUniqueOrThrow({
      where: { id: 'p1' },
      include: { settings: true },
    })
    expect(project.settings?.theme).toBe('dark')

    // The owning side, reached the other way, still works the same as
    // before: `ProjectSettings.project` has an actual foreign key sibling
    // (`projectId`), so both the schema-driven read and the naming
    // heuristic agree it's to-one — this one would pass either way, and is
    // here only to confirm the owning side isn't affected by the change.
    const settings = await db
      .$withoutTenant()
      .projectSettings.findUniqueOrThrow({
        where: { id: 'ps1' },
        include: { project: true },
      })
    expect(settings.project.id).toBe('p1')
  })
})

describe('_count shorthand', () => {
  beforeEach(async () => {
    await resetTestDb()
    // `Tag` is global, and its projects belong to different organizations,
    // so a count reached through it is not limited to one organization by
    // the relation itself.
    await rawDb.tag.update({
      where: { id: 'tag1' },
      data: { projects: { connect: { id: 'p2' } } },
    })
  })

  it('scopes `_count: true` reached from a global model', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      include: { _count: true },
    })

    expect(tag._count.projects).toBe(1)
  })

  it('scopes `_count: true` in a select', async () => {
    const tag = await db.tag.findUniqueOrThrow({
      where: { id: 'tag1' },
      select: { id: true, _count: true },
    })

    expect(tag._count.projects).toBe(1)
  })

  it('counts every relation the shorthand covers', async () => {
    const organization = await rawDb.organization.findUniqueOrThrow({
      where: { id: 'org1' },
      include: { _count: true },
    })
    const scoped = await db.organization.findUniqueOrThrow({
      where: { id: 'org1' },
      include: { _count: true },
    })

    expect(Object.keys(scoped._count).sort()).toEqual(
      Object.keys(organization._count).sort(),
    )
  })
})
