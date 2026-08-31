/** Minimal Result type so libs can fail without throwing across boundaries. */
export type Result<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function unwrap<T>(r: Result<T, unknown>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap called on error Result: ${String(r.error)}`);
}
