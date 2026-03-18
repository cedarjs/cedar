import { FileNode } from '../nodes.js'

import type { RWProject } from './RWProject.js'
/**
 * layouts live in the src/layouts folder
 */
export class RWLayout extends FileNode {
  constructor(
    public filePath: string,
    public parent: RWProject,
  ) {
    super()
  }
}
