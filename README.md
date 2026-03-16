<p align="center">
  <img src="https://avatars.githubusercontent.com/u/211931789?s=200&v=4" width="200" />
  <h1 align="center">CedarJS</h1>
  <p align="center">
    <a href="https://discord.gg/8mNkAgby5m">
      <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord server!"
    /></a>
    <a href="https://cedarjs.com">
      <img src="https://img.shields.io/badge/Documentation-3ECC5F?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" />
    </a>
  </p>
</p>

## About

CedarJS is an opinionated, full-stack React framework that makes building web
applications fast and enjoyable. It includes everything you need: React for the
frontend, GraphQL for the API, Prisma for the database, and built-in support
for authentication, testing, and deployment.

> cedar has become a powerful symbol of strength and revitalization\
> _— https://indigenousfoundations.arts.ubc.ca/cedar/_

See https://cedarjs.com for a modern overview of CedarJS

## Why Cedar?

Whether you're building a startup MVP, a departmental tool, or a full production
application, here's what you get with Cedar:

- Fast Setup. Get from zero to deployed application with a database in minutes,
  not days.
- An extensive CLI with generator and setup commands for most things you want to
  do. A dedicated CLI is faster and cheaper than asking AI to do it for you, and
  100% predictable.
- Team empowerment. Keep your entire stack in TypeScript/JavaScript. No context
  switching between languages or separate teams for frontend and backend.
  Everyone is empowered to contribute across the entire application.
- Architectural decisions made for you, so you don't get stuck in analysis
  paralysis or get decision fatigue. But it doesn't lock you in. You have full
  control over your code, your auth, your database, and your deployment.
- Ready made integrations for hosting on Vercel, Netlify, AWS, Render, or your
  own servers. Switch providers easily without major rewrites.
- A production ready framework. Used by companies in production with a mature
  ecosystem and comprehensive documentation.
- You start with a working app that includes routing, database setup, and
  testing – all configured and ready to go. And if there's more you need, like
  authorization, there's most likely a setup command or a generator for it.

## Who Is Cedar For?

**Startups** that need to move fast and iterate quickly. **Solo developers** who
want to build full-stack apps without managing complex tooling. **Development
teams** that value standardization and clear conventions. **Companies**
transitioning from RedwoodJS or looking for an actively maintained full-stack
framework with a dedicated API layer. Or just about **anyone** who wants to
focus on building features rather than configuring build tools and
infrastructure

## Roadmap

- [x] Make all packages ESM only where possible and ESM+CJS where needed to
      keep compatibility with existing RW apps. Packages still to convert:
  - [x] `@cedarjs/cli`
  - [x] `@cedarjs/fastify-web`
  - [x] `@cedarjs/api-server`
  - [x] `@cedarjs/api`
  - [x] etc. Full list: https://github.com/cedarjs/cedar/issues/19
- [ ] Future major version: Make all packages ESM only
- [ ] Future major version: Make new Cedar apps ESM only
- [ ] Future major version: Make it possible to switch existing Cedar apps to
      ESM
- [ ] Enable strict mode for new Cedar TypeScript apps.
- [x] Upgrade to Node 24
- [x] Setup dependabot/renovate to automatically merge PRs that pass all checks
- [x] Move to Vitest for Cedar ESM apps

### Package Updates

- [ ] Update packages we use to their latest versions. Notable examples:
  - [ ] `react`
  - [ ] `prisma`
  - [ ] `apollo`
  - [ ] `vite`
  - [x] `fastify`

### New Features

- [ ] Better support for file uploads
- [ ] dbAuth version with OAuth support
- [ ] Whatever I need to make it easier to work with the OpenAI API/SDK and
      other AI tools
- [ ] New real-time features (`useLiveQuery` hook)
- [ ] Your feature request here! Let me know what you need!

## The CedarJS Team

<table>
  <tr>
    <td align="center" valign="top" width="25%"><a href="https://tobbe.dev"><img src="https://avatars0.githubusercontent.com/u/30793?v=4" width="100px;" alt=""/><br /><sub><b>Tobbe Lundberg</b></sub></a></td>
    <td align="center" valign="top" width="25%"><img src="https://placehold.co/400x400?text=You?" width="100px;" alt="You?"/></td>
    <td align="center" valign="top" width="25%"><img src="https://placehold.co/400x400?text=You?" width="100px;" alt="You?"/></td>
    <td align="center" valign="top" width="25%"><img src="https://placehold.co/400x400?text=You?" width="100px;" alt="You?"/></td>
  </tr>
</table>

## Sponsors

<table>
  <tr>
    <td align="center" valign="center" width="20%"><a href="https://twodots.net"><img src="https://github.com/user-attachments/assets/a98ae112-9f66-4c0a-a450-fa410725b230" width="100px;" alt="TwoDots"/></a></td>
    <td align="center" valign="center" width="20%"><a href="https://aerafarms.com"><img src="https://raw.githubusercontent.com/cedarjs/cedar/main/docs/static/img/sponsors/aera-logo.png" width="100px;" alt="Aerafarms"/></a></td>
    <td align="center" valign="center" width="20%"><a href="https://rhoimpact.com/"><img src="https://github.com/user-attachments/assets/1eef45f4-e5a4-42a8-b98e-7ee1b711dc4b" width="100px;" alt="Rho Impact"/></a></td>
    <td align="center" valign="center" width="20%"><a href="https://acm.se"><img src="https://raw.githubusercontent.com/cedarjs/cedar/main/docs/static/img/sponsors/acm_se-logo.png" width="100px;" alt="ACM"/></a></td>
    <td align="center" valign="center" width="20%"><img src="https://placehold.co/400x400?text=Your\nCompany?" width="100px;" alt=""/></td>
  </tr>
</table>
