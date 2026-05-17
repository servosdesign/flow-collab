import type { JsonOp } from 'sharedb/lib/client'

export const cloneJson = <T>(document: T) : T => {
  return typeof structuredClone === 'function'
    ? structuredClone(document)
    : JSON.parse(JSON.stringify(document))
}

export const sameJson = (left: unknown, right: unknown) => {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const createReplaceOp = (
  path: Array<string | number>,
  oldValue: unknown,
  nextValue: unknown
) => {
  if (sameJson(oldValue, nextValue)) {
    return undefined
  }

  const operation: JsonOp = {
    p: path,
    oi: nextValue
  }

  if (typeof oldValue !== 'undefined') {
    operation.od = oldValue
  }

  return operation
}
