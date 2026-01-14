import { getConfig } from '../../../../lib/index.js'

const config = getConfig()

export const NETLIFY_TOML = `\
[build]
  command = "yarn cedar deploy netlify"
  publish = "web/dist"
  functions = "api/dist/functions"

  [build.environment]
    NODE_VERSION = "24"

[[redirects]]
  from = "/*"
  to = "/200.html"
  status = 200

# To use Netlify Dev, install Netlify's CLI (\`netlify-cli\`) from NPM and use
# \`netlify link\` to connect your local project to a site on Netlify. Then run
# \`netlify dev\`.
#
# Quick links to the docs:
# - Netlify Dev https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development
# - Netlify's CLI https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/
# - \`netlify link\` https://cli.netlify.com/commands/link/
[dev]
  framework = "redwoodjs"
  # Make sure \`targetPort\` matches \`web.port\` in your cedar.toml file
  targetPort = ${config.web.port}
  # Point your browser to this port to access your app
  port = 8888
`
