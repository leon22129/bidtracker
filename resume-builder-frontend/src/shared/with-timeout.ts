type TimeoutCleanup<T> = {
  onTimeout?: () => unknown
  onLateResult?: (value: T) => unknown
}

function cleanUp(action: (() => unknown) | undefined) {
  try { void Promise.resolve(action?.()).catch(() => {}) } catch { /* Preserve the original failure. */ }
}

/** Bound browser APIs that may never settle, and dispose resources delivered after expiry. */
export function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  message: string,
  cleanup: TimeoutCleanup<T> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      settled = timedOut = true
      reject(Object.assign(new Error(message), { name: "TimeoutError" }))
      cleanUp(cleanup.onTimeout)
    }, timeoutMs)
    Promise.resolve(operation).then((value) => {
      if (settled) {
        if (timedOut) cleanUp(() => cleanup.onLateResult?.(value))
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}
