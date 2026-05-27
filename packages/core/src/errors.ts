import type { RuntimeError, RuntimeErrorCode } from "./types.js"

export function runtimeError(
  code: RuntimeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  if (details === undefined) {
    return { code, message }
  }

  return { code, message, details }
}
