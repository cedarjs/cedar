/**
 * Fetches JSON from a URL, for the provider contract probes in this
 * directory. The parsed body is cast to `T` because `Response#json()` is
 * untyped — every caller immediately runs `toMatchObject`/`toBe` shape
 * assertions against the result, so an unexpected shape fails loudly in the
 * test itself rather than silently passing through here.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; headers: Headers; body: T }> {
  const response = await fetch(url, init)
  const body = (await response.json()) as T
  return { status: response.status, headers: response.headers, body }
}
