import type {
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
} from 'graphql/language/ast'
import type { Location } from 'vscode-languageserver-types'
import { DiagnosticSeverity } from 'vscode-languageserver-types'

import { RWError } from '../errors'
import { BaseNode } from '../nodes'
import { lazy } from '../x/decorators'
import type { ExtendedDiagnostic } from '../x/diagnostics'
import { Position_fromTSMorphOffset } from '../x/diagnostics'

import type { RWSDL } from './RWSDL'
import type { RWServiceFunction } from './RWServiceFunction'

export class RWSDLField extends BaseNode {
  constructor(
    public objectTypeDef: ObjectTypeDefinitionNode,
    public field: FieldDefinitionNode,
    public parent: RWSDL,
  ) {
    super()
  }
  @lazy() get id() {
    return (
      this.parent.id + ' ' + this.objectTypeDef.name.value + '.' + this.name
    )
  }
  /**
   * The location of this field.
   * Calculating this is slightly complicated since it is embedded within a TaggedTemplateLiteral
   */
  @lazy() get location(): Location {
    let { start, end } = this.field.loc!
    const node = this.parent.schemaStringNode!
    start += node.getPos() + 1 // we add one to account for the quote (`)
    end += node.getPos() + 1
    const startPos = Position_fromTSMorphOffset(start, node.getSourceFile())
    const endPos = Position_fromTSMorphOffset(end, node.getSourceFile())
    return { uri: this.parent.uri, range: { start: startPos, end: endPos } }
  }
  @lazy() get name() {
    return this.field.name.value
  }
  @lazy() get argumentNames() {
    return (this.field.arguments ?? []).map((a) => a.name.value)
  }

  /**
   * TODO: describe in prose what is going on here.
   * this is an important rule
   */
  @lazy() get impl(): RWServiceFunction | undefined {
    return (this.parent.service?.funcs ?? []).find((f) => f.name === this.name)
  }

  *diagnostics() {
    if (!this.impl) {
      const { uri, range } = this.location
      yield {
        uri,
        diagnostic: {
          range,
          message: 'Service Not Implemented',
          severity: DiagnosticSeverity.Error,
          code: RWError.SERVICE_NOT_IMPLEMENTED,
        },
      } as ExtendedDiagnostic
    }
  }
}
