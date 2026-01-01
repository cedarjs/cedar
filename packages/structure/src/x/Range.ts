import type { Position } from './Position'
import { Position_create } from './Position'

export interface Range {
  start: Position
  end: Position
}

export function Range_create(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): Range
export function Range_create(start: Position, end: Position): Range
export function Range_create(
  one: number | Position,
  two: number | Position,
  three?: number,
  four?: number,
): Range {
  if (
    typeof one === 'number' &&
    typeof two === 'number' &&
    typeof three === 'number' &&
    typeof four === 'number'
  ) {
    return {
      start: Position_create(one, two),
      end: Position_create(three, four),
    }
  } else if (typeof one === 'object' && typeof two === 'object') {
    return { start: one, end: two }
  }
  throw new Error('Invalid arguments to Range_create')
}
