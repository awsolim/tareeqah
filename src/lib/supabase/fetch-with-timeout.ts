const DEFAULT_TIMEOUT_MS = 15000;

/**
 * A fetch implementation with a hard timeout, for use as Supabase's `global.fetch` option.
 * Without this, a dropped/hanging connection never rejects — every page's data-loading
 * effect awaits its Supabase calls forever, so `setLoading(false)` never runs and the
 * spinner never resolves to an error. With this, a stalled request aborts after
 * `timeoutMs` and rejects like any other network failure, which the existing
 * `{ data, error }` handling already in every loader picks up normally.
 */
export function fetchWithTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const externalSignal = init?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
  };
}
