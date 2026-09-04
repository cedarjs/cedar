# README

This is a test project to use for testing gqlorm related features and changes.

## Preparing the Database

- Delete the .env file
- Run `yarn dlx neon@latest claim create` to provision a database and write
  `DATABASE_URL` to a new .env file
- Run `echo "DIRECT_DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/-pooler\././')" >> .env`
  to set the direct connection Prisma migrations use
- Run `echo "SESSION_SECRET=$(yarn cedar g secret --raw)" >> .env` to generate
  a new session secret for use with dbAuth
- Run migrations: `yarn cedar prisma migrate deploy`
- Seed the database: `yarn cedar prisma db seed`

## Testing with `curl`

```
curl -X POST 'http://localhost:8911/graphql' -H 'content-type: application/json' -d '{"query":"{ cedar { version } }"}'
curl 'http://localhost:8911/graphql?query=\{cedar\{version\}\}'
curl -i 'http://localhost:8911/graphql/health'
curl -i 'http://localhost:8911/graphql/readiness'
```
