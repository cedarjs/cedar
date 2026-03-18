export function lazy<T>() {
  return function (
    _target: object,
    key: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> {
    const getter = descriptor.get
    if (!getter) {
      throw new Error('@lazy can only be used on getters')
    }
    return {
      get(this: Record<string | symbol, T>) {
        const value = getter.call(this)
        Object.defineProperty(this, key, {
          value,
          enumerable: descriptor.enumerable,
        })
        return value
      },
      enumerable: descriptor.enumerable,
      configurable: true,
    }
  }
}

export function memo(keySerializer: (...args: unknown[]) => string = String) {
  return function (
    _target: object,
    _key: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value
    return {
      ...descriptor,
      value(
        this: { __memoCache?: Map<string | symbol, Map<string, unknown>> },
        ...args: unknown[]
      ) {
        if (!this.__memoCache) {
          this.__memoCache = new Map()
        }
        const cacheKey = _key
        if (!this.__memoCache.has(cacheKey)) {
          this.__memoCache.set(cacheKey, new Map())
        }
        const methodCache = this.__memoCache.get(cacheKey)!
        const argsKey = keySerializer(...args)
        if (methodCache.has(argsKey)) {
          return methodCache.get(argsKey)
        }
        const result = original.apply(this, args)
        methodCache.set(argsKey, result)
        return result
      },
    }
  }
}
