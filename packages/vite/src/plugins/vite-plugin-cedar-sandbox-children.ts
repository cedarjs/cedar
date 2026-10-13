import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import {
  SANDBOX_CHILDREN_DIR,
  vendorSandboxChildPackages,
} from '../lib/sandboxChildren.js'
import type { SandboxChildImports } from '../lib/sandboxChildren.js'

/**
 * For the bundled API build (`cedar build --ud`): the sandboxed child
 * scripts in api/src are extra entries of the build (see
 * `findSandboxChildScripts()`), so each comes out as
 * `sandbox-children/<name>.child.js`. This plugin checks that each child
 * stands alone, importing only packages and Node builtins (it can read
 * nothing of the app), and then copies the packages they import into
 * `sandbox-children/node_modules`.
 *
 * `findChildScript()` from `@cedarjs/api/sandbox` finds the children there
 * from code in the bundle.
 */
export function cedarSandboxChildrenPlugin({
  environment,
  children,
}: {
  /** The bundled build's environment */
  environment: string
  /** The child scripts' entries: `{ 'sandbox-children/x.child': file }` */
  children: Record<string, string>
}): Plugin {
  const sources = new Set(
    Object.values(children).map((file) => normalizePath(file)),
  )
  let imports: SandboxChildImports[] = []

  return {
    name: 'cedar-sandbox-children',
    apply: 'build',
    applyToEnvironment(env) {
      return env.name === environment
    },
    generateBundle(_options, bundle) {
      imports = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.facadeModuleId) {
          continue
        }
        const source = normalizePath(chunk.facadeModuleId)
        if (!sources.has(source)) {
          continue
        }

        const bundled = [...chunk.imports, ...chunk.dynamicImports].filter(
          (id) => id in bundle,
        )
        if (bundled.length > 0) {
          this.error(
            `${path.basename(source)} imports your app's own code ` +
              `(${bundled.join(', ')}). A sandboxed child script may import ` +
              'only packages and Node builtins: it runs in a process that ' +
              "can't read the rest of your app.",
          )
        }

        imports.push({
          source,
          imports: [...chunk.imports, ...chunk.dynamicImports],
        })
      }
    },
    writeBundle(options) {
      if (imports.length === 0 || !options.dir) {
        return
      }
      vendorSandboxChildPackages(
        path.join(options.dir, SANDBOX_CHILDREN_DIR),
        imports,
      )
    },
  }
}
