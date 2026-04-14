# README

This is a test project to use for testing gqlorm related features and changes.

## Preparing the Database

- Delete the .env file
- Run `yarn dlx neon-new --yes` to generate a new .env file
- Run `echo "SESSION_SECRET=$(yarn cedar g secret --raw)" >> .env` to generate
  a new session secret for use with dbAuth
- Run migrations: `yarn cedar prisma migrate deploy`
- Seed the database: `yarn cedar prisma db seed`
