---
description: How Prisma relations work with scaffolds
---

# Prisma Relations and Cedar's Generators

## Many-to-many Relationships

A many-to-many relationship is accomplished by creating a "join" or "lookup" table between two other tables.
For example, if a **Product** can have many **Tag**s, any given **Tag** can also have many **Product**s that it is attached to.
A database diagram for this relationship could look like:

```
┌───────────┐     ┌─────────────────┐      ┌───────────┐
│  Product  │     │  ProductsOnTag  │      │    Tag    │
├───────────┤     ├─────────────────┤      ├───────────┤
│ id        │────<│ productId       │   ┌──│ id        │
│ title     │     │ tagId           │>──┘  │ name      │
│ desc      │     └─────────────────┘      └───────────┘
└───────────┘
```

[Here](https://www.prisma.io/docs/concepts/components/prisma-schema/relations#many-to-many-relations)
are Prisma's docs for creating many-to-many relationships.
The `schema.prisma` syntax to create this relationship looks like:

```jsx
model Product {
  id       Int    @id @default(autoincrement())
  title    String
  desc     String
  tags     Tag[]
}

model Tag {
  id       Int     @id @default(autoincrement())
  name     String
  products Product[]
}
```

These relationships can be [implicit](https://www.prisma.io/docs/concepts/components/prisma-schema/relations/many-to-many-relations#implicit-many-to-many-relations) (as this diagram shows) or [explicit](https://www.prisma.io/docs/concepts/components/prisma-schema/relations/many-to-many-relations#explicit-many-to-many-relations) (explained below). Cedar's SDL generator (which is also used by the scaffold generator) only supports an **explicit** many-to-many relationship when generating with the `--crud` flag. What's up with that?

## CRUD Requires an `@id`

CRUD (Create, Retrieve, Update, Delete) actions in Cedar currently require a single, unique field in order to retrieve, update or delete a record. This field must be denoted with Prisma's [`@id`](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#id) attribute, marking it as the tables's primary key. This field is guaranteed to be unique and so can be used to find a specific record.

Prisma's implicit many-to-many relationships create a table _without_ a single field marked with the `@id` attribute. Instead, it uses a similar attribute: [`@@id`](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#id-1) to define a _multi-field ID_. This multi-field ID will become the tables's primary key. The diagram above shows the result of letting Prisma create an implicit relationship.

Since there's no single `@id` field in implicit many-to-many relationships, you can't use the SDL generator with the `--crud` flag. Likewise, you can't use the scaffold generator, which uses the SDL generator (with `--crud`) behind the scenes.

## Supported Table Structure

To support both CRUD actions and to remain consistent with Prisma's many-to-many relationships, a combination of the `@id` and [`@@unique`](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#unique-1) attributes can be used. With this, `@id` is used to create a primary key on the lookup-table; and `@@unique` is used to maintain the table's unique index, which was previously accomplished by the primary key created with `@@id`.

> Removing `@@unique` would let a specific **Product** reference a particular **Tag** more than a single time.

You can get this working by creating an explicit relationship—defining the table structure yourself:

```jsx
model Product {
  id    Int         @id @default(autoincrement())
  title String
  desc  String
  tags  ProductsOnTag[]
}

model Tag {
  id       Int      @id @default(autoincrement())
  name     String
  products ProductsOnTag[]
}

model ProductsOnTag {
  id        Int     @id @default(autoincrement())
  tagId     Int
  tag       Tag     @relation(fields: [tagId], references: [id])
  productId Int
  product   Product @relation(fields: [productId], references: [id])

  @@unique([tagId, productId])
}
```

Which creates a table structure like:

```
┌───────────┐      ┌──────────────────┐     ┌───────────┐
│  Product  │      │  ProductsOnTags  │     │    Tag    │
├───────────┤      ├──────────────────┤     ├───────────┤
│ id        │──┐   │ id               │  ┌──│ id        │
│ title     │  └──<│ productId        │  │  │ name      │
│ desc      │      │ tagId            │>─┘  └───────────┘
└───────────┘      └──────────────────┘

```

Almost identical! But now there's an `id` and the SDL/scaffold generators will work as expected. The explicit syntax gives you a couple additional benefits—you can customize the table name and even add more fields. Maybe you want to track which user tagged a product—add a `userId` column to `ProductsOnTags` and now you know.

## Troubleshooting Generators

GraphQL type generation fails when an SDL references a type that isn't defined anywhere — which is what would happen if you generated the SDL for a Prisma model with relations before the SDLs for the related models exist.

This may sound a little abstract, so let's look at an example. Let's say that you're modeling bookshelves. Your prisma schema has two data models, `Book` and `Shelf`. This is a one to many relationship: a shelf has many books, but a book can only be on one shelf:

```js
model Book {
  id      Int    @id @default(autoincrement())
  title   String @unique
  // highlight-start
  shelf   Shelf? @relation(fields: [shelfId], references: [id])
  shelfId Int?
  // highlight-end
}

model Shelf {
  id    Int    @id @default(autoincrement())
  name  String @unique
  // highlight-next-line
  books Book[]
}
```

The data model looks great. Let's make it real with SDLs and services:

```bash
yarn cedar g sdl Book
```

The type of `Book`'s `shelf` field is `Shelf`, but there's no SDL defining a `Shelf` GraphQL type yet. To keep type generation working, the SDL generator detects this and also generates a read-only _stub_ SDL (and service) for `Shelf`:

```bash
✔ Generating SDL files...
✔ Successfully wrote file $(./api/src/graphql/books.sdl.js)
✔ Successfully wrote file $(./api/src/services/books/books.scenarios.js)
✔ Successfully wrote file $(./api/src/services/books/books.test.js)
✔ Successfully wrote file $(./api/src/services/books/books.js)
✔ Successfully wrote file $(./api/src/graphql/shelves.sdl.js)
✔ Successfully wrote file $(./api/src/services/shelves/shelves.js)
✔ Generating types ...

Book has relations to models that don't have SDL files of their own yet: Shelf
Read-only SDL stubs were generated for them, since GraphQL type generation fails otherwise.
To replace a stub with a full SDL and service, run
  yarn cedar generate sdl Shelf
```

The stub defines the `Shelf` type and a read-only query — no mutations. Each stub file starts with a comment explaining why it exists and how to replace it.

When you're ready to flesh out `Shelf`, run the generator for it:

```bash
yarn cedar g sdl Shelf
```

As long as you haven't edited the stub files, they're replaced without needing `--force`. If you _have_ edited a stub, the generator refuses to overwrite it until you pass `--force`, so your changes are never silently lost.

### Scaffolds

The scaffold generator generates the same read-only stubs for missing related
models, so scaffolding `Book` behaves just like generating its SDL: a stub SDL
and service are generated for `Shelf`, and the same "Read-only SDL stubs were
generated for them" message is printed once the scaffold finishes. When you're
ready to flesh out `Shelf`, run `yarn cedar g sdl Shelf` for just the GraphQL
type and service, or `yarn cedar g scaffold Shelf` if you also want a full
CRUD UI for it.

### Self-Relations

[Self-relations](https://www.prisma.io/docs/concepts/components/prisma-schema/relations/self-relations#one-to-many-self-relations) are useful for modeling parent-child relationships where the parent and child are the "same type of thing".
For example, in a business, everyone is an employee with a role and possibly someone to directly report to:

- President—no direct report (for the purposes of this example)
- Director—reports to the President
- Manager—reports to a Director
- Employee—reports to a Manager, but has no direct reports

Let's use a self-relation to model this in our Prisma schema:

```js
model Employee {
  id            Int       @id @default(autoincrement())
  name          String
  jobTitle      String
  // highlight-start
  reportsToId   Int?      @unique
  reportsTo     Employee? @relation("OrgChart", fields: [reportsToId], references: [id])
  directReports Employee? @relation("OrgChart")
  // highlight-end
}
```

For the generators, what's important here is that the related models are optional.
`reportsToId`, `reportsTo`, and `directReports` use Prisma's `?` syntax to indicate that they're optional—not required.
The Cedar generators may complain or fail if you try to force a requirement here.

It's important because if you're at the top—say you're the President—then you don't have a `reportsTo`, and if you're just an Employee, then you don't have anyone that directly reports to you.
