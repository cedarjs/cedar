import type { Node } from '@babel/types'
import forOwn from 'lodash/forOwn.js'

export const nodeIs = (type: string) => (node: Node) => node.type === type

type RuleFn<T> = (arr: T[]) => number
type ListRulePair<T> = [T[], RuleFn<T>]

// In this algorithm, we take N list-rule-pairs, of the form [[...elements], rule], where `rule` is
// a unary function accepting a result subarray and returning a position (possibly -1) indicating
// where an element of its list may be placed in the given subarray. Each list-rule-pair can be
// thought of as a category of elements that have particular ordering concerns.
// The algorithm returns a minimally-sized array of arrays, where each element occurs exactly once
// in one of the subarrays, and none of the ordering rules are violated.
// It is assumed that no rule prevents an element from being placed alone in its own subarray.
export function sieve<T>(...listRulePairs: ListRulePair<T>[]): T[][] {
  const result: T[][] = [[]]
  for (const [list, rule] of listRulePairs) {
    elementLoop: for (const element of list) {
      for (const arr of result) {
        const position = rule(arr)
        if (position !== -1) {
          arr.splice(position, 0, element)
          continue elementLoop
        }
      }
      // We haven't found an array appropriate to hold element. Assume that any element can
      // appear alone in a list, and create a new array holding that element:
      result.push([element])
    }
  }
  return result
}

type AnyFn = (...args: unknown[]) => unknown

export function forEachFunctionOn(
  object: Record<string, unknown>,
  callback: (key: string, value: AnyFn) => void,
): void {
  forOwn(object, (value, key) => {
    if (typeof value === 'function') {
      // value is narrowed to Function here; cast to AnyFn to satisfy the callback signature
      callback(key, value as AnyFn)
    }
  })
}
