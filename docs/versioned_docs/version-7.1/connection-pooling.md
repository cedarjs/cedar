---
description: Scale your serverless functions
---

# Connection Pooling

> ⚠️ **Work in Progress** ⚠️
>
> There's more to document here. In the meantime, you can check the [Cedar community forums](https://community.redwoodjs.com/search?q=connection%20pooling) for answers.
>
> Want to contribute? CedarJS welcomes contributions and loves helping people become contributors.
> You can edit this doc [here](https://github.com/cedarjs/cedarjs.com/blob/main/docs/connectionPooling.md).
> If you have any questions, just ask for help! We're active on our [discord](https://cedarjs.com/discord).

Production Cedar apps should enable connection pooling in order to properly scale with your Serverless functions.

## Why Connection Pooling?

Relational databases have a maximum number of concurrent client connections.

- Postgres allows 100 by default
- MySQL allows 151 by default

In a traditional server environment, you would need a large amount of traffic (and therefore web servers) to exhaust these connections, since each web server instance typically leverages a single connection.

In a Serverless environment, each function connects directly to the database, which can exhaust limits quickly. To prevent connection errors, you should add a connection pooling service in front of your database. Think of it as a load balancer.

## Prisma

### Prisma Postgres

[Prisma Postgres](https://www.prisma.io/docs/postgres/introduction/overview) is a managed PostgreSQL database service that includes:

- **Built-in connection pooling**: No need to configure external pooling services
- **Global caching**: Query-level caching with TTL and Stale-While-Revalidate strategies
- **Serverless optimization**: Designed specifically for serverless and edge applications
- **Easy setup**: Get started in minutes with minimal configuration

Prisma Postgres supports schema migrations and queries via Prisma ORM, and automatically handles connection pooling and caching.

To get started with Prisma Postgres, visit the [Prisma Postgres documentation](https://www.prisma.io/docs/postgres/introduction/overview).

#### Local Prisma Postgres

For local development, you can use [local Prisma Postgres](https://www.prisma.io/docs/postgres/database/local-development) which runs a PostgreSQL-compatible database locally. This eliminates the need to install and manage PostgreSQL locally while maintaining full compatibility with production PostgreSQL databases.

:::note

To use Local Prisma Postgres, you do not need to create an account or install PostgreSQL locally.

:::

First, update your Prisma schema to use PostgreSQL as the provider:

```graphql title="api/db/schema.prisma"
datasource db {
  provider = "postgresql"
}
```

Start the local Prisma Postgres server:

```bash
npx prisma dev
```

The server will start and display connection options. Press `t` to get the TCP connection URL for standard PostgreSQL connections, or press `h` if you're planning to use Prisma Postgres in production (which requires the [Prisma Client extension](https://www.prisma.io/docs/postgres/introduction/overview#using-the-client-extension-for-prisma-accelerate-required)).

If you're using any other provider for PostgreSQL, use the TCP connection URL in your `.env` file:

```env
DATABASE_URL="postgresql://localhost:54322/main"
```

Keep the server running while performing migrations and using the database for local development.

#### Temporary Prisma Postgres database

For quick testing or prototyping, [Prisma Postgres](https://www.prisma.io/postgres) offers temporary production-ready databases that also requires no setup or accounts. Use [`npx create-db`](https://www.prisma.io/docs/postgres/introduction/npx-create-db) to create a database that's automatically deleted after 24 hours:

```bash
npx create-db@latest
```

This provides both Prisma ORM-optimized and standard PostgreSQL connection strings. You can also claim the database to make it permanent if needed.

### Prisma ORM & Prisma Accelerate

If you're already using another database provider (like Supabase, Heroku, Digital Ocean, or AWS RDS), you can add connection pooling and caching to your existing setup using [Prisma Accelerate](https://www.prisma.io/docs/accelerate).

Prisma Accelerate is a fully managed global connection pool and caching layer that works with your existing database. It provides:

- **Connection pooling**: Efficiently manages database connections across 15+ global regions
- **Global caching**: Hosted in 300+ locations for fast user experiences
- **Query-level caching**: Configure caching strategies directly in your Prisma ORM code
- **Serverless scaling**: Handles traffic spikes without infrastructure concerns
- **Database compatibility**: Works with publicly accessible databases or those behind IP allowlists

To enable Prisma Accelerate with your existing database, visit the [Prisma Accelerate documentation](https://www.prisma.io/docs/accelerate).

### Prisma & PgBouncer

PgBouncer holds a connection pool to the database and proxies incoming client
connections by sitting between Prisma Client and the database. This reduces the
number of processes a database has to handle at any given time. PgBouncer passes
on a limited number of connections to the database and queues additional
connections for delivery when space becomes available.

The recommended way to connect to PostgreSQL (including through PgBouncer) is
via a [driver adapter](https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers)
rather than connection string parameters. The `@prisma/adapter-pg` adapter
handles connection management directly in Node.js.

To use Prisma Client with PgBouncer via driver adapter:

```ts title="api/src/lib/db.ts"
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

// Point DATABASE_URL at your PgBouncer endpoint (typically port 6543)
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
})

export const db = new PrismaClient({ adapter })
```

> Note that Prisma Migrate uses database transactions and is not compatible with PgBouncer in transaction pooling mode. When running migrations, connect directly to the database (port 5432) rather than going through PgBouncer.

For more information, refer to Prisma's guide on [Configuring Prisma Client with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer).

## Supabase

For Postgres running on [Supabase](https://supabase.com) see: [Using Connection Pooling in Supabase](https://supabase.com/blog/supabase-pgbouncer#using-connection-pooling-in-supabase).

All new Supabase projects include connection pooling using [PgBouncer](https://www.pgbouncer.org/).

We recommend that you connect to your Supabase Postgres instance using SSL which you can do by setting `sslmode` to `require` on the connection string:

```
# direct connection (typically port 5432)
postgresql://postgres:mydb.supabase.co:5432/postgres?sslmode=require
# pooled via PgBouncer (typically port 6543)
postgresql://postgres:mydb.supabase.co:6543/postgres?sslmode=require
```

With Prisma v7 and the `@prisma/adapter-pg` driver adapter, pass the pooled connection string as `process.env.DATABASE_URL` — the `?pgbouncer=true` parameter is no longer required.

## Heroku

For Postgres, see [Postgres Connection Pooling](https://devcenter.heroku.com/articles/postgres-connection-pooling).

Heroku does not officially support MySQL.

## Digital Ocean

For Postgres, see [How to Manage Connection Pools](https://www.digitalocean.com/docs/databases/postgresql/how-to/manage-connection-pools)

Digital Ocean managed databases expose two ports: typically `25060` for a direct connection and `25061` for the PgBouncer connection pool.

With Prisma v7 and the `@prisma/adapter-pg` driver adapter, point `DATABASE_URL` at the PgBouncer port and include any required SSL/timeout parameters:

```
postgresql://<user>:<pass>@<host>:25061/defaultdb?sslmode=require&connect_timeout=10
```

The `?pgbouncer=true` and `connection_limit` parameters are no longer required when using a driver adapter.

> Note: Prisma Migrate is not compatible with PgBouncer in transaction pooling mode. When running migrations (e.g. `yarn cedar prisma migrate deploy`), use the direct connection on port `25060` instead.

Connection Pooling for MySQL is not yet supported.

## AWS

Use [Amazon RDS Proxy](https://aws.amazon.com/rds/proxy) for MySQL or PostgreSQL.

From the [AWS Docs](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html#rds-proxy.limitations):

> Your RDS Proxy must be in the same VPC as the database. The proxy can't be publicly accessible.

Because of this limitation, with out-of-the-box configuration, you can only use RDS Proxy if you're deploying your Lambda Functions to the same AWS account. Alternatively, you can use RDS directly, but you might require larger instances to handle your production traffic and the number of concurrent connections.

## Why Connection Pooling?

Relational databases have a maximum number of concurrent client connections.

- Postgres allows 100 by default
- MySQL allows 151 by default

In a traditional server environment, you would need a large amount of traffic (and therefore web servers) to exhaust these connections, since each web server instance typically leverages a single connection.

In a Serverless environment, each function connects directly to the database, which can exhaust limits quickly. To prevent connection errors, you should add a connection pooling service in front of your database. Think of it as a load balancer.
