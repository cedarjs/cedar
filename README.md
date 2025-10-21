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

CedarJS is a fork of the [RedwoodJS GraphQL](https://github.com/redwoodjs/graphql)
framework, actively maintained and used in production by companies of all sizes.
With active development focused on modern web standards and developer experience,
Cedar is evolving with new features and improvements that aren't available in
RedwoodJS.

CedarJS would obviously not be where it is today without the vision and heroic
efforts of the RedwoodJS founders, maintainers and community.

> cedar has become a powerful symbol of strength and revitalization\
> _— https://indigenousfoundations.arts.ubc.ca/cedar/_

## Why Cedar?

### For RedwoodJS Users

If you're currently using RedwoodJS, here's why you might want to consider
Cedar:

- **Active Maintenance**: Cedar is actively maintained by developers who use it
  in production daily. New features, bug fixes, and security updates are
  consistently delivered.
- **New Features**: Cedar includes improvements and features that aren't
  available in RedwoodJS, with more coming regularly.
- **Modern Standards**: Moving toward ESM-only packages and modern JavaScript
  standards to future-proof your applications.
- **Smooth Migration**: Cedar maintains backward compatibility with RedwoodJS
  v8.6, making migration straightforward with a clear upgrade path.

### For Everyone Else

Whether you're building a startup MVP, a departmental tool, or a full
production application, Cedar offers:

- **Zero Boilerplate**: Start with a working app that includes routing,
  database setup, authentication, and testing—all configured and ready to go.
- **Fast Setup**: Get from zero to deployed application with a database in
  minutes, not days.
- **One Language**: Keep your entire stack in TypeScript/JavaScript. No context
  switching between languages or separate teams for frontend and backend.
- **Opinionated but Flexible**: Cedar makes architectural decisions for you,
  but doesn't lock you in. You have full control over your code and deployment.
- **Deploy Anywhere**: Host on Vercel, Netlify, AWS, Render, or your own
  servers. Switch providers easily without major rewrites.
- **Production Ready**: Used by companies in production with a mature ecosystem
  and comprehensive documentation.

### Who Is Cedar For?

Cedar is ideal for:

- **Startups** that need to move fast and iterate quickly
- **Solo developers** who want to build full-stack apps without managing
  complex tooling
- **Development teams** that value standardization and clear conventions
- **Companies** transitioning from RedwoodJS or looking for an actively
  maintained full-stack framework
- **Anyone** who wants to focus on building features rather than configuring
  build tools and infrastructure

## Migrating from RedwoodJS to CedarJS

1. Search and replace all instances of `"@redwoodjs/(.*)": "\d+\.\d+\.\d+"`
   with `"@cedarjs/$1": "0.1.1"` (or whatever the latest version of Cedar is
   when you run this) in all three `package.json` files.
2. Run `yarn install` to update your lock file.
3. Make a git commit with all changes as a checkpoint to make it easier to see
   what changes in the following steps
4. Search and replace all instances of `@redwoodjs` in all files with
   `@cedarjs`.
5. Also find all mentions of `storybook-framework-redwoodjs-vite` and replace
   with `storybook-framework-cedarjs`
6. Pay attention to `yarn.lock`. If anything changed in there you probably have
   to do some manual editing. (Contact me if you need help.)
7. Delete all files and folders inside `.redwood/` except `README.md`
8. Run `yarn install` and `yarn rw build`. Make sure everything works as
   expected.
9. Make a new git commit (or amend the previous one you did)

### Optional steps

- Update `web/vite.config.ts` to have `import { cedar } from '@cedarjs/vite';`
  and `plugins: [cedar()],` instead of the older
  `import redwood from '@redwoodjs/vite';` and `plugins: [redwood()],`

### Unsupported

CedarJS doesn't have the equivalent of Redwood Studio yet. So Studio will not
work for now. Let me know if that's something you use and need.

## Roadmap

### Cleanup

These are things I want to remove to make the surface area of things I need to
maintain smaller. Notice that UI libraries you already have setup will continue
to work. Just new projects won't have the setup support for them. Auth and
deploy providers are more difficult. I'll leave those in longer. Let me know
what you use so I know what to keep and what to remove!

- [ ] Mantine and Chakra-UI setup
- [ ] Redwood Record
- [ ] Telemetry
- [ ] Auth providers I don't know of anyone using
- [ ] Deploy providers I don't know of anyone using
- [x] Old docs versions
- [ ] Old codemods
- [ ] The structure package (internal legacy package)

### Future Proofing

- [ ] Make all packages ESM only where possible and ESM+CJS where needed to
      keep compatibility with existing RW apps. Packages still to convert:
  - [x] `@cedarjs/cli`
  - [ ] `@cedarjs/fastify-web`
  - [ ] `@cedarjs/api-server`
  - [ ] `@cedarjs/api`
  - [ ] etc. Full list: https://github.com/cedarjs/cedar/issues/19
- [ ] Future major version: Make all packages ESM only
- [ ] Future major version: Make new Cedar apps ESM only
- [ ] Future major version: Make it possible to switch existing Cedar apps to
      ESM
- [ ] Enable strict mode for new Cedar TypeScript apps.
- [ ] Upgrade to Node 24
- [x] Setup dependabot/renovate to automatically merge PRs that pass all checks
- [ ] Move to Vitest for Cedar apps to prepare for ESM support

### Package Updates

- [ ] Update packages we use to their latest versions. Notable examples:
  - [ ] `react`
  - [ ] `prisma`
  - [ ] `apollo`
  - [ ] `vite`
  - [x] `fastify`

### Docs

- [x] Mirror the RedwoodJS docs to make sure they don't get deleted
  - Done. See https://cedarjs.com/docs
- [ ] Document where CedarJS diverges from RedwoodJS. (Future major version.)

### New Features

- [ ] Better support for file uploads
- [ ] dbAuth version with OAuth support
- [ ] Whatever I need to make it easier to work with the OpenAI API/SDK and
      other AI tools
- [ ] Your feature request here! Let me know what you need!

## Documentation

0.x releases of CedarJS will be fully compatible with RedwoodJS v8.6, so the
best documentation for CedarJS is actually still the RedwoodJS documentation,
which I have a copy of here: https://cedarjs.com/docs.
I have made a few edits and updates to it, but it's still mostly the same as
[the original](https://redwoodjs.com/docs).

The only thing you'll have to adjust are the package names and replace every
`@redwoodjs` package with a `@cedarjs` package of the same name.

There will be no specific documentation written for CedarJS for now.

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
    <td align="center" valign="center" width="20%"><img src="https://placehold.co/400x400?text=Your\nCompany?" width="100px;" alt=""/></td>
    <td align="center" valign="center" width="20%"><img src="https://placehold.co/400x400?text=Your\nCompany?" width="100px;" alt=""/></td>
    <td align="center" valign="center" width="20%"><img src="https://placehold.co/400x400?text=Your\nCompany?" width="100px;" alt=""/></td>
    <td align="center" valign="center" width="20%"><img src="https://placehold.co/400x400?text=Your\nCompany?" width="100px;" alt=""/></td>
  </tr>
</table>
