export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): T & { cancel: () => void } {
  let timeoutId: NodeJS.Timeout | null = null

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      timeoutId = null
      func(...args)
    }, wait)
  }) as T & { cancel: () => void }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}
