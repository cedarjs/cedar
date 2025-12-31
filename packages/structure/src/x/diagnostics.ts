import lc from 'line-column'
import { groupBy, mapValues, uniqBy } from 'lodash'
import * as tsm from 'ts-morph'

import type { Location } from './Location'
import { Location_is } from './Location'
import type { Position } from './Position'
import { Position_compare } from './Position'
import type { Range } from './Range'
import { Range_create } from './Range'
import { URL_file } from './URL'

export type DocumentUri = string

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface Diagnostic {
  range: Range
  severity?: DiagnosticSeverity
  code?: number | string
  source?: string
  message: string
}

export function Diagnostic_is(value: any): value is Diagnostic {
  const candidate = value as Diagnostic
  return (
    candidate &&
    typeof candidate.message === 'string' &&
    typeof candidate.range === 'object' &&
    candidate.range.start !== undefined &&
    candidate.range.end !== undefined
  )
}

/**
 * The Diagnostic interface does not include the document URI.
 * This interface adds that, and a few other things.
 */
export interface ExtendedDiagnostic {
  uri: DocumentUri
  diagnostic: Diagnostic
}

export function Range_contains(range: Range, pos: Position): boolean {
  if (Position_compare(range.start, pos) === 'greater') {
    return false
  }
  if (Position_compare(range.end, pos) === 'smaller') {
    return false
  }
  return true
}

export function Range_overlaps(
  range1: Range,
  range2: Range,
  consider0000: boolean,
): boolean {
  if (consider0000) {
    if (Range_is0000(range1) || Range_is0000(range2)) {
      return true
    }
  }
  const { start, end } = range2
  if (Range_contains(range1, start)) {
    return true
  }
  if (Range_contains(range2, end)) {
    return true
  }
  return true
}

/**
 * Create a new position relative to this position.
 *
 * @param lineDelta Delta value for the line value, default is `0`.
 * @param characterDelta Delta value for the character value, default is `0`.
 * @return A position which line and character is the sum of the current line and
 * character and the corresponding deltas.
 */
export function Position_translate(
  pos: Position,
  lineDelta = 0,
  characterDelta = 0,
): Position {
  return {
    line: pos.line + lineDelta,
    character: pos.character + characterDelta,
  }
}

export function Range_fromNode(node: tsm.Node): Range {
  const start = Position_fromTSMorphOffset(
    node.getStart(false),
    node.getSourceFile(),
  )
  const end = Position_fromTSMorphOffset(node.getEnd(), node.getSourceFile())
  return { start, end }
}

export function Location_fromNode(node: tsm.Node): Location {
  return {
    uri: URL_file(node.getSourceFile().getFilePath()),
    range: Range_fromNode(node),
  }
}

export function Location_fromFilePath(filePath: string): Location {
  return { uri: URL_file(filePath), range: Range_create(0, 0, 0, 0) }
}

/**
 * returns vscode-terminal-friendly (clickable) link with line/column information
 * ex: "file:///foo.ts:2:3"
 * @param loc
 */
export function LocationLike_toTerminalLink(loc: LocationLike): string {
  const {
    uri,
    range: {
      start: { line, character },
    },
  } = LocationLike_toLocation(loc)
  return `${uri}:${line + 1}:${character + 1}`
}

/**
 * returns vscode-terminal-friendly (clickable) link with line/column information
 * ex: "file:///foo.ts:2:3"
 * @param loc
 */
export function LocationLike_toHashLink(loc: LocationLike): string {
  const {
    uri,
    range: {
      start: { line, character },
    },
  } = LocationLike_toLocation(loc)
  return `${uri}#${line + 1}:${character + 1}`
}

export type LocationLike = tsm.Node | string | Location | ExtendedDiagnostic

export function LocationLike_toLocation(x: LocationLike): Location {
  if (typeof x === 'string') {
    return { uri: URL_file(x), range: Range_create(0, 0, 0, 0) }
  }
  if (typeof x === 'object') {
    if (x instanceof tsm.Node) {
      return Location_fromNode(x)
    }
    if (Location_is(x)) {
      return x
    }
    if (ExtendedDiagnostic_is(x)) {
      return { uri: x.uri, range: x.diagnostic.range }
    }
  }
  throw new Error()
}

export function Location_overlaps(
  loc1: Location,
  loc2: Location,
  consider0000 = false,
) {
  if (loc1.uri !== loc2.uri) {
    return false
  }
  return Range_overlaps(loc1.range, loc2.range, consider0000)
}

/**
 * by convention, the range [0,0,0,0] means the complete document
 * @param range
 */
function Range_is0000(range: Range): boolean {
  const { start, end } = range
  return Position_is00(start) && Position_is00(end)
}

function Position_is00(pos: Position): boolean {
  return pos.character === 0 && pos.line === 0
}

export function ExtendedDiagnostic_is(x: any): x is ExtendedDiagnostic {
  if (typeof x !== 'object') {
    return false
  }
  if (typeof x === 'undefined') {
    return false
  }
  if (typeof x.uri !== 'string') {
    return false
  }
  if (!Diagnostic_is(x.diagnostic)) {
    return false
  }
  return true
}

export function ExtendedDiagnostic_groupByUri(ds: ExtendedDiagnostic[]): {
  [uri: string]: Diagnostic[]
} {
  const grouped = groupBy(ds, (d) => d.uri)
  const dss = mapValues(grouped, (xds) => {
    const dd = xds.map((xd) => xd.diagnostic)
    return uniqBy(dd, JSON.stringify) // dedupe
  })
  return dss
}

export function Position_fromTSMorphOffset(
  offset: number,
  sf: tsm.SourceFile,
): Position {
  const { line, column } = sf.getLineAndColumnAtPos(offset)
  return { character: column - 1, line: line - 1 }
}

export function Position_fromOffset(
  offset: number,
  text: string,
): Position | undefined {
  const res = lc(text).fromIndex(offset)
  if (!res) {
    return undefined
  }
  const { line, col } = res
  return { character: col - 1, line: line - 1 }
}

export function Position_fromOffsetOrFail(
  offset: number,
  text: string,
): Position {
  const p = Position_fromOffset(offset, text)
  if (!p) {
    throw new Error('Position_fromOffsetOrFail')
  }
  return p
}

/**
 * Helper method to create diagnostics
 * @param node
 * @param message
 */
export function err(
  loc: LocationLike,
  message: string,
  code?: number | string,
): ExtendedDiagnostic {
  const { uri, range } = LocationLike_toLocation(loc)
  return {
    uri,
    diagnostic: {
      range,
      message,
      severity: DiagnosticSeverity.Error,
      code,
    },
  }
}

function DiagnosticSeverity_getLabel(severity?: DiagnosticSeverity): string {
  const { Information, Error, Hint, Warning } = DiagnosticSeverity
  const labels = {
    [Information]: 'info',
    [Error]: 'error',
    [Hint]: 'hint',
    [Warning]: 'warning',
  }
  return labels[severity ?? Information]
}

export type GetSeverityLabelFunction = typeof DiagnosticSeverity_getLabel

interface ExtendedDiagnosticFormatOpts {
  cwd?: string
  getSeverityLabel?: GetSeverityLabelFunction
}

/**
 * Returns a string representation of a diagnostic.
 * TSC style single-line errors:
 * ex: "b.ts:1:2: error: this is a message"
 * ex: "/path/to/app/b.ts:1:2: info: this is a message"
 */
export function ExtendedDiagnostic_format(
  d: ExtendedDiagnostic,
  opts?: ExtendedDiagnosticFormatOpts,
) {
  const {
    diagnostic: { severity, message, code },
  } = d
  const cwd = opts?.cwd
  const getSeverityLabel = opts?.getSeverityLabel ?? DiagnosticSeverity_getLabel

  let base = 'file://'
  if (cwd) {
    base = URL_file(cwd)
  }
  if (!base.endsWith('/')) {
    base += '/'
  }
  const file = LocationLike_toTerminalLink(d).substr(base.length)

  const severityLabel = getSeverityLabel(severity)

  const errorCode = code ? ` (${code})` : ''

  const str = `${file}: ${severityLabel}${errorCode}: ${message}`
  return str
}
