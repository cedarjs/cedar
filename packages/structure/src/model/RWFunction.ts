import { FileNode } from '../nodes.js'

import type { RWProject } from './RWProject.js'
/**
 * functions exist in the /functions folder
 */
export class RWFunction extends FileNode {
  constructor(
    public filePath: string,
    public parent: RWProject,
  ) {
    super()
  }
}
