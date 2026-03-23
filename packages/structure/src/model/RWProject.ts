import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import type { DMMF } from '@prisma/generator-helper'
import type PrismaInternals from '@prisma/internals'

import {
  getPaths,
  processPagesDir,
  getConfigPath,
  getPrismaSchemas,
} from '@cedarjs/project-config'

import { BaseNode } from '../nodes.js'
import { lazy, memo } from '../x/decorators.js'
import {
  followsDirNameConvention,
  isCellFileName,
  isLayoutFileName,
  globSync,
} from '../x/path.js'
import { URL_file } from '../x/URL.js'

import { RWCell } from './RWCell.js'
import { RWComponent } from './RWComponent.js'
import { RWEnvHelper } from './RWEnvHelper.js'
import { RWFunction } from './RWFunction.js'
import { RWLayout } from './RWLayout.js'
import { RWPage } from './RWPage.js'
import { RWRouter } from './RWRouter.js'
import { RWSDL } from './RWSDL.js'
import { RWService } from './RWService.js'
import { RWTOML } from './RWTOML.js'

// @prisma/internals is a CJS-only bundle that uses Object.defineProperty with
// getter functions for its exports. Node's ESM named-export static analysis
// cannot detect these, so we use createRequire to access them reliably.
const _require = createRequire(import.meta.url)
const { getDMMF } = _require('@prisma/internals') as typeof PrismaInternals

const allFilesGlob = '/**/*.{js,jsx,ts,tsx}'

/**
 * Represents a Redwood project.
 * This is the root node.
 */
export class RWProject extends BaseNode {
  parent = undefined

  @lazy() get id() {
    return URL_file(this.pathHelper.base)
  }

  children() {
    return [
      this.redwoodTOML,
      ...this.pages,
      this.router,
      ...this.services,
      ...this.sdls,
      ...this.layouts,
      ...this.components,
      this.envHelper,
    ]
  }

  /**
   * Path constants that are relevant to a Redwood project.
   */
  @lazy() get pathHelper() {
    return getPaths()
  }

  /**
   * Checks for the presence of a tsconfig.json at the root.
   */
  @lazy() get isTypeScriptProject(): boolean {
    return (
      fs.existsSync(path.join(this.pathHelper.web.base, 'tsconfig.json')) ||
      fs.existsSync(path.join(this.pathHelper.api.base, 'tsconfig.json'))
    )
  }

  // TODO: do we move this to a separate node? (ex: RWDatabase)
  @memo() async prismaDMMF(): Promise<DMMF.Document | undefined> {
    try {
      const result = await getPrismaSchemas()
      const datamodel = result.schemas
      // consider case where dmmf doesn't exist (or fails to parse)
      return await getDMMF({ datamodel })
    } catch {
      return undefined
    }
  }

  @memo() async prismaDMMFModelNames() {
    const dmmf = await this.prismaDMMF()
    if (!dmmf) {
      return []
    }
    return dmmf.datamodel.models.map((m) => m.name)
  }

  @lazy() get redwoodTOML(): RWTOML {
    return new RWTOML(getConfigPath(), this)
  }

  @lazy() private get processPagesDir() {
    try {
      return processPagesDir(this.pathHelper.web.pages)
    } catch {
      return []
    }
  }

  @lazy() get pages(): RWPage[] {
    return this.processPagesDir.map(
      (p) => new RWPage(p.constName, p.path, this),
    )
  }

  @lazy() get router() {
    return this.getRouter()
  }
  getRouter = () => {
    return new RWRouter(this.pathHelper.web.routes, this)
  }

  // TODO: move to path helper
  servicesFilePath(name: string) {
    // name = blog,posts
    const ext = this.isTypeScriptProject ? '.ts' : '.js'
    return path.join(this.pathHelper.api.services, name, name + ext)
  }

  // TODO: move to path helper
  @lazy() get defaultNotFoundPageFilePath() {
    const ext = this.isTypeScriptProject ? '.tsx' : '.jsx'
    return path.join(
      this.pathHelper.web.pages,
      'NotFoundPage',
      'NotFoundPage' + ext,
    )
  }

  @lazy() get services() {
    // TODO: what is the official logic?
    // TODO: Support both `/services/todos/todos.js` AND `/services/todos.js`
    return globSync(this.pathHelper.api.services + allFilesGlob)
      .filter(followsDirNameConvention)
      .map((x) => new RWService(x, this))
  }

  @lazy() get sdls() {
    return globSync(this.pathHelper.api.graphql + '/**/*.sdl.{js,ts}').map(
      (x) => new RWSDL(x, this),
    )
  }

  @lazy() get layouts(): RWLayout[] {
    // TODO: what is the official logic?
    return globSync(this.pathHelper.web.layouts + allFilesGlob)
      .filter(followsDirNameConvention)
      .filter(isLayoutFileName)
      .map((x) => new RWLayout(x, this))
  }

  @lazy() get functions(): RWFunction[] {
    // TODO: what is the official logic?
    return globSync(this.pathHelper.api.functions + allFilesGlob).map(
      (x) => new RWFunction(x, this),
    )
  }

  @lazy() get components(): RWComponent[] {
    return globSync(this.pathHelper.web.components + allFilesGlob).map(
      (file) => {
        if (isCellFileName(file)) {
          const possibleCell = new RWCell(file, this)
          return possibleCell.isCell
            ? possibleCell
            : new RWComponent(file, this)
        }
        return new RWComponent(file, this)
      },
    )
  }

  @lazy() get sides() {
    return ['web', 'api']
  }

  // TODO: Wrap these in a real model.
  @lazy() get mocks() {
    return globSync(this.pathHelper.web.base + '/**/*.mock.{js,ts}')
  }

  /**
   * A "Cell" is a component that ends in `Cell.{js, jsx, tsx}`, but does not
   * have a default export AND does not export `QUERY`
   **/
  @lazy() get cells(): RWCell[] {
    return globSync(this.pathHelper.web.base + '/**/*Cell.{js,jsx,tsx}')
      .map((file) => new RWCell(file, this))
      .filter((file) => file.isCell)
  }

  @lazy() get envHelper(): RWEnvHelper {
    return new RWEnvHelper(this)
  }
}
