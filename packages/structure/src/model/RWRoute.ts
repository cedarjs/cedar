import * as tsm from 'ts-morph'

import { RWError } from '../errors'
import { BaseNode } from '../nodes'
import { validateRoutePath } from '../util'
import { lazy } from '../x/decorators'
import { err, LocationLike_toLocation } from '../x/diagnostics'
import type { Location } from '../x/Location'

import type { RWRouter } from './RWRouter'

export class RWRoute extends BaseNode {
  constructor(
    /**
     * the <Route> tag
     */
    public jsxNode: tsm.JsxSelfClosingElement,
    public parent: RWRouter,
  ) {
    super()
  }

  @lazy() get id() {
    // we cannot rely on the "path" attribute of the node
    // it might not be unique (which is an error state, but valid while editing)
    return this.parent.id + ' ' + this.jsxNode.getStart()
  }

  @lazy() get location(): Location {
    return LocationLike_toLocation(this.jsxNode)
  }

  @lazy() get isPrivate() {
    const tagText = this.jsxNode
      .getParentIfKind(tsm.SyntaxKind.JsxElement)
      ?.getOpeningElement()
      ?.getTagNameNode()
      ?.getText()
    return tagText === 'Private' || tagText === 'PrivateSet'
  }

  @lazy() get unauthenticated() {
    if (!this.isPrivate) {
      return undefined
    }

    const a = this.jsxNode
      .getParentIfKind(tsm.SyntaxKind.JsxElement)
      ?.getOpeningElement()
      .getAttribute('unauthenticated')

    if (!a) {
      return undefined
    }
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer()
      if (tsm.Node.isStringLiteral(init)) {
        return init.getLiteralValue()
      }
    }
    return undefined
  }

  @lazy()
  get roles() {
    if (!this.isPrivate) {
      return undefined
    }

    const a = this.jsxNode
      .getParentIfKind(tsm.SyntaxKind.JsxElement)
      ?.getOpeningElement()
      .getAttribute('roles')

    if (!a) {
      return undefined
    }

    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer()

      // Handle string literals
      if (tsm.Node.isStringLiteral(init)) {
        const literalValue = init.getLiteralValue()

        // Check if the string looks like an array with single quotes
        if (literalValue.startsWith('[') && literalValue.endsWith(']')) {
          try {
            // Unescape the string by replacing single quotes with double quotes
            const correctedLiteralValue = literalValue.replace(/'/g, '"')
            // Attempt to parse as JSON array
            const parsedValue = JSON.parse(correctedLiteralValue)
            if (Array.isArray(parsedValue)) {
              return parsedValue
            }
          } catch {
            // If parsing fails, return undefined
            return undefined
          }
        }

        // If not an array, return the string value
        return literalValue
      }

      // Handle JSX expressions with array literals
      if (tsm.Node.isJsxExpression(init)) {
        const expr = init.getExpression()
        if (tsm.Node.isArrayLiteralExpression(expr)) {
          return expr
            .getElements()
            .map((element) => {
              if (tsm.Node.isStringLiteral(element)) {
                return element.getLiteralValue()
              }
              return undefined
            })
            .filter((val) => val !== undefined)
        }
      }
    }
    return undefined
  }

  @lazy() get hasParameters(): boolean {
    if (!this.path) {
      return false
    }
    // KLUDGE: we need a good path parsing library here
    return this.path.includes('{')
  }

  @lazy() get hasPrerender() {
    return this.prerender
  }

  /**
   * The associated Redwood Page node, if any
   */

  @lazy() get page() {
    if (!this.page_identifier_str) {
      return undefined
    }
    return this.parent.parent.pages.find(
      (p) => p.constName === this.page_identifier_str,
    )
  }
  /**
   * <Route path="" page={THIS_IDENTIFIER}/>
   */
  @lazy() private get page_identifier(): tsm.Identifier | undefined {
    const a = this.jsxNode.getAttribute('page')
    if (!a) {
      return undefined
    }
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer()
      if (tsm.Node.isJsxExpression(init)) {
        const expr = init.getExpression()
        if (tsm.Node.isIdentifier(expr)) {
          return expr
        }
      }
    }
    return undefined
  }
  @lazy() get page_identifier_str(): string | undefined {
    return this.page_identifier?.getText()
  }
  @lazy() get name(): string | undefined {
    return this.getStringAttr('name')
  }
  @lazy() get path_errorMessage(): string | undefined {
    // TODO: path validation is not strong enough
    if (typeof this.path === 'undefined') {
      return undefined
    }
    try {
      validateRoutePath(this.path)
      return undefined
    } catch (e: any) {
      return e.toString()
    }
  }
  @lazy() get path(): string | undefined {
    return this.getStringAttr('path')
  }

  @lazy() get prerender(): boolean {
    return this.getBoolAttr('prerender')
  }

  // TODO (STREAMING) Remove this once we're sure we don't want to do Render Modes
  @lazy() get renderMode(): string | undefined {
    return this.getStringAttr('renderMode') || 'stream'
  }

  @lazy() get path_literal_node() {
    const a = this.jsxNode.getAttribute('path')
    if (!a) {
      return undefined
    }
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer()
      if (tsm.Node.isStringLiteral(init)) {
        return init
      }
    }
    return undefined
  }

  @lazy() get isNotFound(): boolean {
    return typeof this.jsxNode.getAttribute('notfound') !== 'undefined'
  }

  @lazy() get redirect() {
    return this.getStringAttr('redirect')
  }

  *diagnostics() {
    if (this.page_identifier && !this.page) {
      // normally this would be caught by TypeScript
      // but Redwood has some "magic" import behavior going on
      yield err(this.page_identifier, 'Page component not found')
    }
    if (this.path_errorMessage && this.path_literal_node) {
      yield err(
        this.path_literal_node,
        this.path_errorMessage,
        RWError.INVALID_ROUTE_PATH_SYNTAX,
      )
    }
    if (this.hasPathCollision) {
      yield err(this.path_literal_node!, 'Duplicate Path')
    }
    if (this.isPrivate && this.isNotFound) {
      yield err(
        this.jsxNode,
        "The 'Not Found' page cannot be within a <PrivateSet> or a <Private> tag",
      )
    }
    if (this.isNotFound && this.path) {
      yield err(
        this.path_literal_node!,
        "The 'Not Found' page cannot have a path",
      )
    }
  }

  @lazy() private get hasPathCollision() {
    if (!this.path) {
      return false
    }
    const pathWithNoParamNames = removeParamNames(this.path)
    for (const route2 of this.parent.routes) {
      if (route2 === this) {
        continue
      }
      if (!route2.path) {
        continue
      }
      if (removeParamNames(route2.path) === pathWithNoParamNames) {
        return true
      }
    }
    return false
    function removeParamNames(p: string) {
      // TODO: implement
      // foo/{bar}/baz --> foo/{}/baz
      return p
    }
  }

  private getBoolAttr(name: string) {
    const attr = this.jsxNode.getAttribute(name)
    // No attribute
    if (!attr) {
      return false
    }

    // Attribute exists
    if (tsm.Node.isJsxAttribute(attr)) {
      const init = attr.getInitializer()

      // Bool attributes with no initializer are true
      // e.g. <Route prerender />
      if (!init) {
        return true
      }

      if (tsm.Node.isJsxExpression(init)) {
        // If it is explicitly set to true
        // e.g. <Route prerender={true} />
        return tsm.Node.isTrueLiteral(init.getExpression())
      } else if (tsm.Node.isStringLiteral(init)) {
        // If its using the incorrect string form, we're accepting it as true
        // e.g. <Route prerender="true" />
        const literalValue = init.getLiteralValue()
        return literalValue === 'true'
      }
    }

    return false
  }

  private getStringAttr(name: string) {
    const a = this.jsxNode.getAttribute(name)
    if (!a) {
      return undefined
    }
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer()
      if (tsm.Node.isStringLiteral(init)) {
        return init.getLiteralValue()
      }
    }
    return undefined
  }
}
