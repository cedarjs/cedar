export interface Position {
  line: number
  character: number
}

export function Position_create(line: number, character: number): Position {
  return { line, character }
}

/**
 * p1 is greater|smaller|equal than/to p2
 * @param p1
 * @param p2
 */
export function Position_compare(
  p1: Position,
  p2: Position,
): 'greater' | 'smaller' | 'equal' {
  if (p1.line > p2.line) {
    return 'greater'
  }
  if (p2.line > p1.line) {
    return 'smaller'
  }
  if (p1.character > p2.character) {
    return 'greater'
  }
  if (p2.character > p1.character) {
    return 'smaller'
  }
  return 'equal'
}
