"use client";

import type { Session } from "@supabase/supabase-js";
import { emptyUserAccess, loadUserAccessByMosqueSlug, type UserAccess } from "@/lib/authz";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MosqueChrome = {
  name: string;
  logoUrl: string | null;
};

type ProfileSummary = {
  fullName: string | null;
  avatarUrl: string | null;
};

let sessionLoaded = false;
let cachedSession: Session | null = null;
let sessionPromise: Promise<Session | null> | null = null;
let authListenerStarted = false;

const sessionSubscribers = new Set<(session: Session | null) => void>();
const mosqueChromeCache = new Map<string, MosqueChrome>();
const mosqueChromePromises = new Map<string, Promise<MosqueChrome | null>>();
const accessCache = new Map<string, UserAccess>();
const accessPromises = new Map<string, Promise<UserAccess>>();
const profileNameCache = new Map<string, string | null>();
const profileNamePromises = new Map<string, Promise<string | null>>();
const profileSummaryCache = new Map<string, ProfileSummary>();
const profileSummaryPromises = new Map<string, Promise<ProfileSummary>>();

export function getCachedSessionSnapshot() {
  return sessionLoaded ? cachedSession : undefined;
}

export function setCachedSessionSnapshot(session: Session | null) {
  sessionLoaded = true;
  cachedSession = session;
  sessionSubscribers.forEach((listener) => listener(session));
}

export function subscribeCachedSession(listener: (session: Session | null) => void) {
  startAuthListener();
  sessionSubscribers.add(listener);
  return () => {
    sessionSubscribers.delete(listener);
  };
}

export async function loadCachedSession() {
  startAuthListener();
  if (sessionLoaded) {
    return cachedSession;
  }

  if (!sessionPromise) {
    sessionPromise = createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        setCachedSessionSnapshot(data.session);
        return data.session;
      })
      .finally(() => {
        sessionPromise = null;
      });
  }

  return sessionPromise;
}

export function clearUserScopedCaches() {
  accessCache.clear();
  accessPromises.clear();
  profileNameCache.clear();
  profileNamePromises.clear();
  profileSummaryCache.clear();
  profileSummaryPromises.clear();
}

export function getCachedMosqueChrome(slug: string) {
  return mosqueChromeCache.get(slug) ?? null;
}

export async function loadMosqueChrome(slug: string) {
  const cached = mosqueChromeCache.get(slug);
  if (cached) {
    return cached;
  }

  const existing = mosqueChromePromises.get(slug);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const { data } = await createSupabaseBrowserClient().from("mosques").select("name, slug, logo_url").eq("slug", slug).maybeSingle();

      if (!data?.name) {
        return null;
      }

      const chrome = { name: titleFromSlug(data.slug || slug), logoUrl: data.logo_url ?? null };
      mosqueChromeCache.set(slug, chrome);
      return chrome;
  })().finally(() => {
      mosqueChromePromises.delete(slug);
    });

  mosqueChromePromises.set(slug, promise);
  return promise;
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getCachedUserAccess(slug: string, userId: string) {
  return accessCache.get(accessKey(slug, userId)) ?? null;
}

export async function loadCachedUserAccess(slug: string, userId: string) {
  const key = accessKey(slug, userId);
  const cached = accessCache.get(key);
  if (cached) {
    return cached;
  }

  const existing = accessPromises.get(key);
  if (existing) {
    return existing;
  }

  const promise = loadUserAccessByMosqueSlug(slug)
    .then((access) => {
      accessCache.set(key, access);
      return access;
    })
    .catch(() => emptyUserAccess)
    .finally(() => {
      accessPromises.delete(key);
    });

  accessPromises.set(key, promise);
  return promise;
}

export function getCachedProfileName(userId: string) {
  return profileNameCache.has(userId) ? profileNameCache.get(userId) ?? null : undefined;
}

export function getCachedProfileSummary(userId: string) {
  return profileSummaryCache.get(userId) ?? undefined;
}

export async function loadCachedProfileName(userId: string) {
  if (profileNameCache.has(userId)) {
    return profileNameCache.get(userId) ?? null;
  }

  const existing = profileNamePromises.get(userId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const { data } = await createSupabaseBrowserClient()
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

      const name = data?.full_name?.trim() || null;
      profileNameCache.set(userId, name);
      return name;
  })()
    .catch(() => null)
    .finally(() => {
      profileNamePromises.delete(userId);
    });

  profileNamePromises.set(userId, promise);
  return promise;
}

export function setCachedProfileName(userId: string, name: string | null) {
  profileNameCache.set(userId, name);
  profileNamePromises.delete(userId);
  const cachedSummary = profileSummaryCache.get(userId);
  if (cachedSummary) {
    profileSummaryCache.set(userId, { ...cachedSummary, fullName: name });
  }
}

export async function refreshCachedProfileName(userId: string) {
  profileNameCache.delete(userId);
  profileNamePromises.delete(userId);
  return loadCachedProfileName(userId);
}

export async function loadCachedProfileSummary(userId: string) {
  const cached = profileSummaryCache.get(userId);
  if (cached) {
    return cached;
  }

  const existing = profileSummaryPromises.get(userId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const { data } = await createSupabaseBrowserClient()
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    const summary = {
      fullName: data?.full_name?.trim() || null,
      avatarUrl: data?.avatar_url?.trim() || null,
    };
    profileSummaryCache.set(userId, summary);
    profileNameCache.set(userId, summary.fullName);
    return summary;
  })()
    .catch(() => ({ fullName: null, avatarUrl: null }))
    .finally(() => {
      profileSummaryPromises.delete(userId);
    });

  profileSummaryPromises.set(userId, promise);
  return promise;
}

export function setCachedProfileSummary(userId: string, summary: Partial<ProfileSummary>) {
  const current = profileSummaryCache.get(userId) ?? { fullName: profileNameCache.get(userId) ?? null, avatarUrl: null };
  const next = { ...current, ...summary };
  profileSummaryCache.set(userId, next);
  profileSummaryPromises.delete(userId);
  profileNameCache.set(userId, next.fullName);
}

export async function refreshCachedProfileSummary(userId: string) {
  profileSummaryCache.delete(userId);
  profileSummaryPromises.delete(userId);
  return loadCachedProfileSummary(userId);
}

export async function performClientLogout() {
  clearUserScopedCaches();
  setCachedSessionSnapshot(null);
  await createSupabaseBrowserClient().auth.signOut();
}

function startAuthListener() {
  if (authListenerStarted) {
    return;
  }

  authListenerStarted = true;
  createSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => {
    setCachedSessionSnapshot(session);
    if (!session) {
      clearUserScopedCaches();
    }
  });
}

function accessKey(slug: string, userId: string) {
  return `${slug}:${userId}`;
}
