import fs from 'node:fs'
import module from 'node:module'
import path from 'node:path'

import type { Plugin } from 'esbuild'

import { build, defaultBuildOptions } from '@cedarjs/framework-tools'

const jsBanner = `\
#!/usr/bin/env node

const require = (await import("node:module")).createRequire(import.meta.url);
const __filename = (await import("node:url")).fileURLToPath(import.meta.url);
const __dirname = (await import("node:path")).dirname(__filename);
`

// We need this ESBuild plugin because cfonts do a dynamic require for font
// .json files using (basically) `require('../fonts/${fontName}.json')`
// When bundling ESBuild doesn't support dynamic requires like that one, so we
// rewrite the import to use font files that we include in our dist output
const fontPathRedirectPlugin: Plugin = {
  name: 'font-path-redirect',
  setup(build) {
    // Intercept the loading of cfonts js files to modify their content
    build.onLoad({ filter: /cfonts\/.+\.js$/ }, async (args) => {
      try {
        const source = await fs.promises.readFile(args.path, 'utf8')

        let modifiedSource = source
        let hasChanges = false

        // Look for the relative font require pattern so we can replace it
        modifiedSource = modifiedSource.replace(
          /\(\s*`\.\.\/fonts\/\$\{([^}]+)\}\.json`\s*\)/g,
          (_match, fontVar) => {
            hasChanges = true
            return `(__dirname + \`/fonts/\${${fontVar}}.json\`)`
          },
        )

        if (hasChanges) {
          console.log(`Modified font paths in: ${args.path}`)
          return {
            contents: modifiedSource,
            loader: 'js',
          }
        }
      } catch (error) {
        console.error(`Error processing ${args.path}:`, error)
      }

      // Let esbuild handle it normally
      return null
    })
  },
}

await build({
  buildOptions: {
    ...defaultBuildOptions,
    banner: {
      js: jsBanner,
    },
    bundle: true,
    entryPoints: ['src/create-cedar-app.js'],
    format: 'esm',
    minify: true,
    plugins: [fontPathRedirectPlugin],
  },
})

// Copy fonts from cfonts package to where cfonts expects them at runtime
// (after our esbuild plugin updates the require path)
const require = module.createRequire(import.meta.url)
const cfontsPackagePath = path.dirname(require.resolve('cfonts/package.json'))
const cfontsFontsPath = path.join(cfontsPackagePath, 'fonts')
const targetFontsPath = path.join('dist', 'fonts')

try {
  fs.cpSync(cfontsFontsPath, targetFontsPath, { recursive: true })
} catch (error) {
  console.error('Failed to copy fonts from cfonts package:', error)
  throw error
}
