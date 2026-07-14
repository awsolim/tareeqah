"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { emptyUserAccess, getAccountLabel, type UserAccess } from "@/lib/authz";
import { getCachedSessionSnapshot, loadCachedSession, loadCachedUserAccess, refreshCachedProfileName, subscribeCachedSession } from "@/lib/client-cache";

export function AuthStatusActions({ loginHref, mosqueSlug }: { loginHref: string; mosqueSlug: string }) {
  const cachedSession = getCachedSessionSnapshot();
  const [session, setSession] = useState<Session | null>(cachedSession ?? null);
  const [access, setAccess] = useState<UserAccess>(emptyUserAccess);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedSession === undefined);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeCachedSession((nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAccess(emptyUserAccess);
        setProfileName(null);
      }
      setLoading(false);
    });

    loadCachedSession().then((nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session) {
      return () => {
        cancelled = true;
      };
    }

    Promise.all([
      loadCachedUserAccess(mosqueSlug, session.user.id),
      refreshCachedProfileName(session.user.id),
    ]).then(([nextAccess, nextProfileName]) => {
      if (!cancelled) {
        setAccess(nextAccess);
        setProfileName(nextProfileName);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mosqueSlug, session]);

  useEffect(() => {
    if (!session?.user.id) {
      return;
    }

    let cancelled = false;
    const refreshProfileName = () => {
      refreshCachedProfileName(session.user.id).then((nextProfileName) => {
        if (!cancelled) {
          setProfileName(nextProfileName);
        }
      });
    };

    window.addEventListener("tareeqah:profile-name-changed", refreshProfileName);
    return () => {
      cancelled = true;
      window.removeEventListener("tareeqah:profile-name-changed", refreshProfileName);
    };
  }, [session]);

  const displayName = useMemo(() => {
    if (profileName) {
      return profileName;
    }

    return session?.user.email?.replace(/@.*/, "") ?? "Guest";
  }, [profileName, session]);

  const accountLabel = useMemo(() => (session ? getAccountLabel(access) : "Not signed in"), [access, session]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      {session ? (
        null
      ) : (
        <Link
          href={loginHref}
          className="flex h-10 w-9 items-center justify-center bg-transparent text-[#238948] drop-shadow-[0_0_7px_rgba(53,168,83,0.55)]"
          aria-label="Sign in"
          title="Sign in"
        >
          <EnterDoorIcon />
        </Link>
      )}

      <div className="w-[112px] min-w-0 text-right min-[390px]:w-36" title={session?.user.email ?? "Not signed in"}>
        {loading ? (
          <div className="ml-auto h-8 w-20 bg-[#F2F4F5]" />
        ) : session ? (
          <>
            <p className="line-clamp-2 overflow-hidden break-words text-[11px] font-medium leading-[13px] text-[#26323A] min-[390px]:text-xs">{displayName}</p>
            <p className="mt-0.5 truncate text-[10px] leading-3 text-[#6B747B]">{accountLabel}</p>
          </>
        ) : (
          <>
            <p className="text-[11px] font-medium leading-[13px] text-[#26323A] min-[390px]:text-xs">Guest</p>
            <p className="truncate text-[10px] leading-4 text-[#6B747B] min-[390px]:text-[11px]">Not signed in</p>
          </>
        )}
      </div>
    </div>
  );
}

function EnterDoorIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M20 7h5v18h-5" />
      <path d="M5 16h14" />
      <path d="m14 10 6 6-6 6" />
    </svg>
  );
}
