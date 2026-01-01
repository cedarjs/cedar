import type { Range } from './Range'

export type DocumentUri = string

export interface Location {
  uri: DocumentUri
  range: Range
}

export function Location_create(uri: DocumentUri, range: Range): Location {
  return { uri, range }
}

export function Location_is(value: any): value is Location {
  const candidate = value as Location
  return (
    candidate &&
    typeof candidate.uri === 'string' &&
    typeof candidate.range === 'object' &&
    candidate.range.start !== undefined &&
    candidate.range.end !== undefined
  )
}
