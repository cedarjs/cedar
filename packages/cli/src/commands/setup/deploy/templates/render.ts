import path from 'path'

import { getPaths } from '../../../../lib/index.js'
import { getUserApiUrl } from '../helpers/index.js'

export const PROJECT_NAME = path.basename(getPaths().base)

export const RENDER_YAML = (database: string, plan = 'free') => {
  const apiUrl = getUserApiUrl().replace(/\/$/, '')
  return `# Quick links to the docs:
# - Deploying Cedar: https://cedarjs.com/docs/deploy/render
# - Render's own walkthrough (uses \`yarn rw\`, but just swap in \`yarn cedar\`):
#   https://render.com/docs/deploy-redwood
# - Render's Blueprint spec: https://render.com/docs/blueprint-spec

services:
- name: ${PROJECT_NAME}-web
  type: web
  runtime: static
  buildCommand: npm install --global corepack && yarn install && yarn cedar deploy render web
  staticPublishPath: ./web/dist

  envVars:
  - key: SKIP_INSTALL_DEPS
    value: true

  routes:
  - type: rewrite
    source: ${apiUrl}/*
    # Replace \`destination\` after your first deploy, with the api service's
    # URL from the Render dashboard:
    #
    # \`\`\`
    # destination: https://${PROJECT_NAME}-api.onrender.com/*
    # \`\`\`
    #
    # This can't be filled in automatically — Render's \`fromService\` only
    # resolves service hosts into \`envVars\`, not into a static site's route
    # destination.
    destination: replace_with_api_url/*
  - type: rewrite
    source: /*
    destination: /200.html

- name: ${PROJECT_NAME}-api
  type: web
  plan: ${plan}
  runtime: node
  region: oregon
  buildCommand: npm install --global corepack && yarn install && yarn cedar build api
  startCommand: yarn cedar deploy render api

  # Proves the GraphQL server is actually serving, not just that the process
  # is alive. Returns 200 with an \`x-yoga-id\` response header.
  #
  # The route is \`<apiRootPath><graphiQLEndpoint>/health\`, and the value below
  # assumes both defaults (\`/\` and \`/graphql\`). Update it to match if you
  # customize either — by setting \`CEDAR_API_ROOT_PATH\` in the envVars below,
  # by passing \`apiRootPath\` to \`createServer\` in \`api/src/server.ts\`, or by
  # setting \`graphiQLEndpoint\` in \`api/src/functions/graphql.ts\`. A mismatch
  # here 404s, and Render will not promote the deploy.
  healthCheckPath: /graphql/health

  envVars:
${database}
`
}

export const POSTGRES_YAML = `\
  - key: DATABASE_URL
    fromDatabase:
      name: ${PROJECT_NAME}-db
      property: connectionString

databases:
  - name: ${PROJECT_NAME}-db
    plan: free
    region: oregon`

export const SQLITE_YAML = `\
  - key: DATABASE_URL
    value: file:./data/sqlite.db
  # Persistent disks aren't available on Render's free plan, which is why
  # the api service above is on a paid plan when SQLite is selected.
  disk:
    name: sqlite-data
    mountPath: /opt/render/project/src/api/db/data
    sizeGB: 1`
