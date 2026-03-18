import * as tsm from 'ts-morph'

import { FileNode } from '../nodes.js'
import { iter } from '../x/Array.js'
import { lazy } from '../x/decorators.js'
import { basenameNoExt } from '../x/path.js'

import type { RWProject } from './RWProject.js'
import type { RWSDL } from './RWSDL.js'
import { RWServiceFunction } from './RWServiceFunction.js'

export class RWService extends FileNode {
  constructor(
    public filePath: string,
    public parent: RWProject,
  ) {
    super()
  }
  /**
   * The name of this service:
   * services/todos/todos.js --> todos
   */
  @lazy() get name() {
    return basenameNoExt(this.filePath)
  }

  /**
   * Returns the SDL associated with this service (if any).
   * Match is performed by name.
   */

  @lazy() get sdl(): RWSDL | undefined {
    return this.parent.sdls.find((sdl) => sdl.name === this.name)
  }

  children() {
    return [...this.funcs]
  }

  /**
   * All the exported functions declared in this service file.
   * They can be both ArrowFunctions (with name) or FunctionDeclarations (with name)
   */

  @lazy() get funcs() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return iter(function* () {
      // export const foo = () => {}
      for (const vd of self.sf.getVariableDeclarations()) {
        if (vd.isExported()) {
          const init = vd.getInitializerIfKind(tsm.SyntaxKind.ArrowFunction)
          if (init) {
            yield new RWServiceFunction(vd.getName(), init, self)
          }
        }
      }
      // export function foo(){}
      for (const fd of self.sf.getFunctions()) {
        if (fd.isExported() && !fd.isDefaultExport()) {
          const nn = fd.getNameNode()
          if (nn) {
            yield new RWServiceFunction(nn.getText(), fd, self)
          }
        }
      }
    })
  }
}
