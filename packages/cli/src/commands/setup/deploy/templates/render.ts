import path from 'path'

import { getPaths } from '../../../../lib/index.js'
import { getUserApiUrl } from '../helpers/index.js'

export const PROJECT_NAME = path.basename(getPaths().base)

export const RENDER_YAML = (database: string) => {
  const apiUrl = getUserApiUrl().replace(/\/$/, '')
  return `# Quick links to the docs:
# - Deploying Cedar: https://cedarjs.com/docs/deploy/render
# - Render's own walkthrough (pre-fork, uses \`yarn rw\` — swap in \`yarn cedar\`):
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
  plan: free
  runtime: node
  region: oregon
  buildCommand: npm install --global corepack && yarn install && yarn cedar build api
  startCommand: yarn cedar deploy render api

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
    region: oregon`

export const SQLITE_YAML = `\
  - key: DATABASE_URL
    value: file:./data/sqlite.db
  disk:
    name: sqlite-data
    mountPath: /opt/render/project/src/api/db/data
    sizeGB: 1`

export const RENDER_HEALTH_CHECK = `\
// render-health-check
export const handler = async () => {
  return {
    statusCode: 200,
  }
}
`
