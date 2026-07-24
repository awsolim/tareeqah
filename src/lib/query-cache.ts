"use client";

import { useEffect, useRef, useState } from "react";

// Generalizes the module-level Map + in-flight-promise-dedup pattern already proven in
// client-cache.ts (session/access/profile caching) into a reusable "cache-and-revalidate"
// hook for any Supabase-backed data component. The goal: repeat visits to a page within the
// same app session render instantly from cache instead of re-fetching and showing a spinner
// every time, while a background refetch keeps the view from ever being far out of date.

type CacheEntry<T> = { data: T; updatedAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, listener: () => void) {
  const set = subscribers.get(key) ?? new Set<() => void>();
  set.add(listener);
  subscribers.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      subscribers.delete(key);
    }
  };
}

async function runFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, updatedAt: Date.now() });
      notify(key);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Serves cached data instantly (no loading state) on remount within the same session, while
 * revalidating in the background once the entry is older than staleTimeMs. On a truly cold
 * key (never fetched this session), behaves like a plain useEffect fetch: loading until the
 * first result arrives.
 *
 * `key` may be null/undefined to skip fetching entirely (e.g. while waiting on a prerequisite
 * like a resolved user id) — the hook simply stays in the loading state until a real key shows up.
 */
function cacheSnapshot<T>(key: string | null | undefined) {
  const entry = key ? (cache.get(key) as CacheEntry<T> | undefined) : undefined;
  return { data: entry?.data, loading: !entry };
}

export function useCachedQuery<T>(
  key: string | null | undefined,
  fetcher: () => Promise<T>,
  options?: { staleTimeMs?: number },
): { data: T | undefined; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const staleTimeMs = options?.staleTimeMs ?? 30_000;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [trackedKey, setTrackedKey] = useState(key);
  const [{ data, loading }, setSnapshot] = useState<{ data: T | undefined; loading: boolean }>(() => cacheSnapshot<T>(key));
  const [error, setError] = useState<string | null>(null);

  // React's documented pattern for resetting derived state when a prop changes: adjust state
  // synchronously during render (not in an effect) so the very first render for a new key
  // already reflects that key's cache, instead of flashing the previous key's data for a frame.
  if (trackedKey !== key) {
    setTrackedKey(key);
    setSnapshot(cacheSnapshot<T>(key));
    setError(null);
  }

  async function load(force: boolean) {
    if (!key) {
      return;
    }
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (entry && !force && Date.now() - entry.updatedAt < staleTimeMs) {
      return;
    }
    try {
      await runFetch(key, () => fetcherRef.current());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSnapshot((current) => ({ ...current, loading: false }));
    }
  }

  useEffect(() => {
    if (!key) {
      return;
    }

    const unsubscribe = subscribe(key, () => {
      setSnapshot({ data: (cache.get(key) as CacheEntry<T> | undefined)?.data, loading: false });
      setError(null);
    });

    // load()'s own setState calls only happen inside an awaited async continuation (the
    // catch block, or runFetch's .then()), never synchronously here — this kicks off a
    // background fetch/subscribe, matching the effect's job of syncing with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function refetch() {
    setError(null);
    await load(true);
  }

  return { data, loading, error, refetch };
}

/** Drops one cached entry and notifies any mounted consumers to refetch on next read. */
export function invalidateQuery(key: string) {
  cache.delete(key);
  notify(key);
}

/** Drops every cached entry whose key starts with `prefix` (e.g. all keys for one program). */
export function invalidateQueryPrefix(prefix: string) {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      notify(key);
    }
  }
}

/** Fire-and-forget warm the cache ahead of navigation; safe to call outside a component. */
export function prefetchQuery<T>(key: string, fetcher: () => Promise<T>) {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.updatedAt < 30_000) {
    return;
  }
  void runFetch(key, fetcher).catch(() => undefined);
}

/** Drops every cached query — called on sign-out so the next login never renders a stale
 * previous user's data from a shared in-memory cache within the same browser tab. */
export function clearAllQueryCache() {
  for (const key of Array.from(cache.keys())) {
    cache.delete(key);
    notify(key);
  }
}
