import * as tsm from 'ts-morph'

import { RWError } from '../errors'
import { FileNode } from '../nodes'
import { iter } from '../x/Array'
import { lazy, memo } from '../x/decorators'
import type { ExtendedDiagnostic } from '../x/diagnostics'
import { err, LocationLike_toLocation } from '../x/diagnostics'
import { DiagnosticSeverity } from '../x/diagnostics'
import { URL_file } from '../x/URL'

import type { RWProject } from './RWProject'
import { RWRoute } from './RWRoute'

/**
 * one per Routes.js
 */
export class RWRouter extends FileNode {
  constructor(
    public filePath: string,
    public parent: RWProject,
  ) {
    super()
  }
  // this is used by the live preview
  @memo() getFilePathForRoutePath(routePath: string): string | undefined {
    // TODO: params
    return this.routes.find((r) => r.path === routePath)?.page?.filePath
  }
  // this is used by the live preview
  @memo() getRoutePathForFilePath(filePath: string): string | undefined {
    // TODO: params
    const path = this.parent.pages.find((p) => p.filePath === filePath)?.route
      ?.path
    if (path?.includes('{')) {
      return
    }
    return path
  }

  /**
   * the `<Router>` tag
   */
  @lazy() private get jsxNode() {
    return this.sf
      .getDescendantsOfKind(tsm.SyntaxKind.JsxOpeningElement)
      .find((x) => x.getTagNameNode().getText() === 'Router')
  }

  /**
   * One per `<Route>`
   */
  @lazy() get routes() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    return iter(function* () {
      if (!self.jsxNode) {
        return
      }
      // TODO: make sure that they are nested within the <Router> tag
      // we are not checking it right now

      const sets = self.sf
        .getDescendantsOfKind(tsm.SyntaxKind.JsxElement)
        .filter((x) => {
          const tagName = x.getOpeningElement().getTagNameNode().getText()
          return (
            tagName === 'Set' ||
            tagName === 'Private' ||
            tagName === 'PrivateSet'
          )
        })

      const prerenderSets = sets.filter((set) =>
        set.getOpeningElement().getAttribute('prerender'),
      )

      for (const set of prerenderSets) {
        for (const x of set.getDescendantsOfKind(
          tsm.SyntaxKind.JsxSelfClosingElement,
        )) {
          const tagName = x.getTagNameNode().getText()
          // Add prerender prop from <Set> if not already present
          if (tagName === 'Route' && !x.getAttribute('prerender')) {
            x.insertAttribute(0, { name: 'prerender' })
          }
        }
      }

      for (const x of self.sf.getDescendantsOfKind(
        tsm.SyntaxKind.JsxSelfClosingElement,
      )) {
        const tagName = x.getTagNameNode().getText()
        if (tagName === 'Route') {
          yield new RWRoute(x, self)
        }
      }
    })
  }

  @lazy() private get numNotFoundPages(): number {
    return this.routes.filter((r) => r.isNotFound).length
  }

  *diagnostics() {
    if (!this.fileExists) {
      // should we assign this error to the project? to redwood.toml?
      const uri = URL_file(this.parent.projectRoot, 'redwood.toml')
      const message = `Routes.js does not exist`
      yield err(uri, message)
      // TODO: add quickFix (create a simple Routes.js)
      return // stop checking for errors if the file doesn't exist
    }

    if (!this.jsxNode) {
      return
    }

    if (this.numNotFoundPages === 0) {
      const { uri, range } = LocationLike_toLocation(this.jsxNode)
      yield {
        uri,
        diagnostic: {
          range,
          message: "You must specify a 'notfound' page",
          severity: DiagnosticSeverity.Error,
        },
      } as ExtendedDiagnostic
    } else if (this.numNotFoundPages > 1) {
      const e = err(
        this.jsxNode,
        "You must specify exactly one 'notfound' page",
        RWError.NOTFOUND_PAGE_NOT_DEFINED,
      )
      yield e
    }
  }
  children() {
    return [...this.routes]
  }
}
