"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useStudentNotificationCounts, useTeacherNotificationCounts } from "@/components/data/supabase-public-sections";
import type { NavItem } from "@/components/layout/horizontal-nav";
import { emptyUserAccess, type UserAccess } from "@/lib/authz";
import {
  getCachedMosqueChrome,
  getCachedProfileName,
  getCachedSessionSnapshot,
  getCachedUserAccess,
  loadCachedProfileName,
  loadCachedSession,
  loadCachedUserAccess,
  loadMosqueChrome,
  refreshCachedProfileName,
  subscribeCachedSession,
} from "@/lib/client-cache";
import { cn } from "@/lib/utils";

function BottomNav({ items, inboxBadgeCount = 0 }: { items: NavItem[]; inboxBadgeCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [previewNavVisible, setPreviewNavVisible] = useState<boolean | null>(null);
  const itemByLabel = new Map(items.map((item) => [item.label, item]));
  const visibleItems = ["Home", "Classes", "Inbox", "Members", "Masjid", "Me"]
    .map((label) => itemByLabel.get(label))
    .filter((item): item is NavItem => Boolean(item));
  const currentIndex = visibleItems.findIndex((item) => isNavItemActive(pathname, item));
  const shouldShow = previewNavVisible ?? isMainTabRoute(pendingHref ?? pathname, visibleItems);

  useEffect(() => {
    for (const item of items) {
      router.prefetch(item.href);
    }
  }, [items, router]);

  useEffect(() => {
    setPendingHref(null);
    setPreviewNavVisible(null);
  }, [pathname]);

  useEffect(() => {
    function handlePreview(event: Event) {
      const detail = (event as CustomEvent<{ fromPath?: string; kind?: string }>).detail;
      if (!detail || detail.fromPath !== pathname) {
        return;
      }
      setPreviewNavVisible(detail.kind !== "subpage");
    }

    window.addEventListener("tareeqah:nav-preview", handlePreview);
    return () => window.removeEventListener("tareeqah:nav-preview", handlePreview);
  }, [pathname]);

  function transitionDirection(targetIndex: number) {
    if (currentIndex < 0 || targetIndex === currentIndex) {
      return "";
    }

    return targetIndex > currentIndex ? "from-right" : "from-left";
  }

  function beginNavigation(targetIndex: number, item: NavItem) {
    const direction = transitionDirection(targetIndex);
    if (typeof window !== "undefined" && direction) {
      window.dispatchEvent(
        new CustomEvent("tareeqah:nav-preview", {
          detail: {
            href: item.href,
            label: item.label,
            direction,
            fromPath: pathname,
          },
        }),
      );
    }

    const href = item.href;
    router.prefetch(href);
    if (pathname !== href) {
      setPendingHref(href);
      router.push(href);
    }
  }

  if (!shouldShow) {
    return null;
  }

  return (
    <nav
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-[2147483647] h-[calc(74px+env(safe-area-inset-bottom))] overflow-visible bg-transparent md:hidden"
      style={{
        transform: "translate3d(0,0,0)",
        contain: "layout paint style",
      }}
      aria-label="Mobile primary navigation"
    >
      <div
        className={cn(
          "mx-auto grid h-full w-full max-w-md rounded-t-[34px] border-x border-t border-[#D6DCE0] pb-[env(safe-area-inset-bottom)]",
          "bg-white",
        )}
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item, index) => {
          const active = pendingHref ? pendingHref === item.href : isNavItemActive(pathname, item);
          const badgeCount = item.label === "Inbox" ? inboxBadgeCount : 0;
          return (
            <Link
              key={`${item.label}-${item.href}`}
              href={item.href}
              onClick={(event) => {
                if (pathname === item.href && !pendingHref) {
                  return;
                }

                event.preventDefault();
                beginNavigation(index, item);
              }}
              className={cn(
                "relative flex h-[74px] min-w-0 flex-col items-center justify-start px-1 pt-2.5 text-[11px] font-medium text-[#7B858C]",
                active && "text-[#17624F]",
              )}
            >
              <span
                className="relative flex h-9 w-[52px] shrink-0 items-center justify-center"
                aria-hidden
              >
                <span className="relative flex h-9 w-[52px] items-center justify-center">
                <NavIcon label={item.label} active={active} />
                {badgeCount ? <NavBadge count={badgeCount} /> : null}
                </span>
              </span>
              <span className="mt-0.5 block h-4 w-full truncate text-center leading-4">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileBottomNav({
  mosqueSlug,
  navItems,
  mobileNavItems,
}: {
  mosqueSlug?: string;
  navItems: NavItem[];
  mobileNavItems?: NavItem[];
}) {
  const resolvedItems = mobileNavItems ?? navItems;
  const portalInboxHref = mosqueSlug ? `/m/${mosqueSlug}/portal/announcements` : "";
  const teacherInboxHref = mosqueSlug ? `/m/${mosqueSlug}/teacher/inbox` : "";
  const showStudentBadges = Boolean(resolvedItems.some((item) => item.label === "Inbox" && item.href === portalInboxHref));
  const showTeacherBadges = Boolean(resolvedItems.some((item) => item.label === "Inbox" && item.href === teacherInboxHref));
  const { totalCount: studentTotalCount } = useStudentNotificationCounts(showStudentBadges ? (mosqueSlug ?? "") : "");
  const { totalCount: teacherTotalCount } = useTeacherNotificationCounts(showTeacherBadges ? (mosqueSlug ?? "") : "");
  const inboxBadgeCount = showStudentBadges ? studentTotalCount : showTeacherBadges ? teacherTotalCount : 0;

  return <BottomNav items={resolvedItems} inboxBadgeCount={inboxBadgeCount} />;
}

function isNavItemActive(pathname: string, item: NavItem) {
  return pathname === item.href || (item.label !== "Home" && pathname.startsWith(`${item.href}/`));
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E25241] px-1 text-[11px] font-semibold leading-none text-white shadow-[0_4px_10px_rgba(226,82,65,0.35)] ring-2 ring-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function NavIcon({ label, active = false }: { label: string; active?: boolean }) {
  const className = "h-6 w-6";
  const strokeWidth = 1.8;

  if (active && label === "Home") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M4.8 10.9 12 4.55l7.2 6.35a.95.95 0 0 1-1.26 1.42l-.44-.39v6.48A2.1 2.1 0 0 1 15.4 20.5H8.6a2.1 2.1 0 0 1-2.1-2.09v-6.48l-.44.39A.95.95 0 1 1 4.8 10.9Z" />
      </svg>
    );
  }

  if (active && label === "Classes") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M7.2 4.5h8.9a3.1 3.1 0 0 1 3.1 3.1v10.2a1.7 1.7 0 0 1-2.45 1.52l-4.45-2.2a.65.65 0 0 0-.58 0l-4.47 2.2A1.7 1.7 0 0 1 4.8 17.8V6.9a2.4 2.4 0 0 1 2.4-2.4Zm1.8 5a.8.8 0 0 0 0 1.6h6a.8.8 0 0 0 0-1.6H9Zm0 3.4a.8.8 0 0 0 0 1.6h4.1a.8.8 0 0 0 0-1.6H9Z" />
      </svg>
    );
  }

  if (active && label === "Inbox") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M6.1 5.25h11.8a2.85 2.85 0 0 1 2.85 2.85v7.8a2.85 2.85 0 0 1-2.85 2.85H6.1a2.85 2.85 0 0 1-2.85-2.85V8.1A2.85 2.85 0 0 1 6.1 5.25Zm.36 3.12 5.09 3.78a.75.75 0 0 0 .9 0l5.09-3.78a.72.72 0 1 0-.86-1.16L12 10.68 7.32 7.21a.72.72 0 0 0-.86 1.16Z" />
      </svg>
    );
  }

  if (active && label === "Members") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M9 10.7a3.35 3.35 0 1 0 0-6.7 3.35 3.35 0 0 0 0 6.7Z" />
        <path d="M3.15 18.9c.74-3.18 2.7-4.76 5.85-4.76s5.11 1.58 5.85 4.76a.82.82 0 0 1-.8 1H3.95a.82.82 0 0 1-.8-1Z" />
        <path d="M16.5 10.2a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
        <path d="M15.55 13.65c2.66.18 4.33 1.65 5.02 4.42a.72.72 0 0 1-.7.9h-3.62c-.24-1.7-.9-3.06-1.98-4.08.36-.5.79-.91 1.28-1.24Z" />
      </svg>
    );
  }

  if (active && label === "Masjid") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M5.4 10.2 12 4.4l6.6 5.8v8.15a2.15 2.15 0 0 1-2.15 2.15H7.55a2.15 2.15 0 0 1-2.15-2.15V10.2Z" />
        <path d="M9.1 9.15a2.9 2.9 0 0 1 5.8 0v2.2H9.1v-2.2Z" fill="white" opacity=".92" />
        <path d="M8.15 14.25h7.7v6.25h-7.7v-6.25Z" fill="white" opacity=".86" />
      </svg>
    );
  }

  if (active && label === "Me") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 11.35a3.95 3.95 0 1 0 0-7.9 3.95 3.95 0 0 0 0 7.9Z" />
        <path d="M5.15 19.48c.87-3.62 3.16-5.44 6.85-5.44s5.98 1.82 6.85 5.44a.86.86 0 0 1-.84 1.07H5.99a.86.86 0 0 1-.84-1.07Z" />
      </svg>
    );
  }

  if (label === "Home") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.75 10.95 12 4.55l7.25 6.4" />
        <path d="M6.65 11.1v7.25a2 2 0 0 0 2 2h6.7a2 2 0 0 0 2-2V11.1" />
      </svg>
    );
  }

  if (label === "Classes") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.35 6.95a2.4 2.4 0 0 1 2.4-2.4h8.5a2.4 2.4 0 0 1 2.4 2.4v10.75a1.2 1.2 0 0 1-1.72 1.08l-4.43-2.13a1.15 1.15 0 0 0-1 0l-4.43 2.13a1.2 1.2 0 0 1-1.72-1.08V6.95Z" />
        <path d="M8.8 9.35h6.4" />
        <path d="M8.8 12.85h4.4" />
      </svg>
    );
  }

  if (label === "Inbox") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.9" y="5.55" width="16.2" height="12.9" rx="2.4" />
        <path d="m5.9 8.25 5.58 4.15a.85.85 0 0 0 1.04 0l5.58-4.15" />
      </svg>
    );
  }

  if (label === "Members") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="7.4" r="3.1" />
        <path d="M3.8 19.3c.75-3.35 2.48-5.02 5.2-5.02s4.45 1.67 5.2 5.02" />
        <circle cx="16.6" cy="8.1" r="2.45" />
        <path d="M15.45 14.2c2.1.3 3.5 1.7 4.2 4.2" />
      </svg>
    );
  }

  if (label === "Masjid") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.25 10.4 12 4.45l6.75 5.95v7.75a2.1 2.1 0 0 1-2.1 2.1H7.35a2.1 2.1 0 0 1-2.1-2.1V10.4Z" />
        <path d="M9.1 11.2V9.05a2.9 2.9 0 0 1 5.8 0v2.15" />
        <path d="M8.35 14.2h7.3" />
        <path d="M8.35 17.15h7.3" />
      </svg>
    );
  }

  if (label === "Me") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7.75" r="3.65" />
        <path d="M5.25 19.75c.9-3.75 3.15-5.62 6.75-5.62s5.85 1.87 6.75 5.62" />
      </svg>
    );
  }

  return <span className="text-sm">{label[0]}</span>;
}

export function AppTopBar({
  appName,
  mosqueSlug,
  homeHref,
  navItems,
  mobileNavItems,
}: {
  appName: string;
  mosqueSlug?: string;
  homeHref: string;
  navItems: NavItem[];
  mobileNavItems?: NavItem[];
}) {
  const pathname = usePathname();
  const showTopBar = isMainTabRoute(pathname, mobileNavItems ?? navItems);
  const [displayName, setDisplayName] = useState(
    mosqueSlug ? titleFromSlug(mosqueSlug) : appName
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const cachedSession = getCachedSessionSnapshot();
  const [session, setSession] = useState<Session | null | undefined>(cachedSession);
  const [access, setAccess] = useState<UserAccess>(() =>
    cachedSession?.user.id && mosqueSlug ? getCachedUserAccess(mosqueSlug, cachedSession.user.id) ?? emptyUserAccess : emptyUserAccess,
  );
  const [profileName, setProfileName] = useState<string | null>(() =>
    cachedSession?.user.id ? getCachedProfileName(cachedSession.user.id) ?? null : null,
  );
  const [accessResolved, setAccessResolved] = useState(() => {
    if (cachedSession === null) return true;
    return Boolean(cachedSession?.user.id && mosqueSlug && getCachedUserAccess(mosqueSlug, cachedSession.user.id));
  });
  const [profileResolved, setProfileResolved] = useState(() => {
    if (cachedSession === null) return true;
    return Boolean(cachedSession?.user.id && getCachedProfileName(cachedSession.user.id) !== undefined);
  });

  useEffect(() => {
    if (!mosqueSlug) {
      setDisplayName(appName);
      setLogoUrl(null);
      return;
    }

    let cancelled = false;

    const cachedChrome = getCachedMosqueChrome(mosqueSlug);

    if (cachedChrome) {
      setDisplayName(cachedChrome.name);
      setLogoUrl(cachedChrome.logoUrl);
    }

    loadMosqueChrome(mosqueSlug).then((data) => {
      if (!cancelled && data) {
        setDisplayName(data.name);
        setLogoUrl(data.logoUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mosqueSlug, appName]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeCachedSession((nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAccess(emptyUserAccess);
        setProfileName(null);
        setAccessResolved(true);
        setProfileResolved(true);
      } else {
        setAccessResolved(false);
        setProfileResolved(false);
      }
    });

    loadCachedSession().then((nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session?.user.id || !mosqueSlug) {
      setAccess(emptyUserAccess);
      if (session === null) {
        setAccessResolved(true);
        setProfileResolved(true);
      }
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
        setAccessResolved(true);
        setProfileResolved(true);
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
      loadCachedProfileName(session.user.id).then((nextProfileName) => {
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

  const userFirstName = useMemo(() => {
    const display = profileName?.trim() || session?.user.email?.replace(/@.*/, "") || "Guest";
    return display.split(/\s+/)[0] || "Guest";
  }, [profileName, session]);

  const accountInitial = useMemo(() => getAccountInitial(access, session ?? null), [access, session]);
  const accountReady = session !== undefined && (session === null || (accessResolved && profileResolved));

  if (!showTopBar) {
    return null;
  }


  return (
    <header className="sticky top-0 z-30 border-b border-[#E4E9EC] bg-white text-[#26323A] md:hidden">
      <div className="app-container grid min-h-[42px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-1">
        <Link href={homeHref} className="flex min-w-0 items-center gap-2">
          <TopBarLogo src={logoUrl} name={displayName} compact />
          <span className="min-w-0 truncate text-[13px] font-semibold leading-4 text-[#26323A]">{displayName}</span>
        </Link>
        <p className="whitespace-nowrap text-center text-[10px] font-medium leading-3 text-[#7B858C]">
          Powered by Tareeqah
        </p>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {!accountReady ? (
            <>
              <span className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-[#E4E9EC]" />
              <span className="h-3 w-12 animate-pulse rounded bg-[#E4E9EC]" />
            </>
          ) : (
            <>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#17624F] text-[11px] font-semibold leading-none text-white">
                {accountInitial ?? <GuestProfileIcon />}
              </span>
              <span className="min-w-0 max-w-[74px] truncate text-right text-[12px] font-semibold leading-4 text-[#26323A]">
                {userFirstName}
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function isMainTabRoute(pathname: string, items: NavItem[]) {
  const mainLabels = new Set(["Home", "Classes", "Inbox", "Members", "Masjid", "Me"]);
  return items.some((item) => mainLabels.has(item.label) && pathname === item.href);
}

function TopBarLogo({ src, name, compact = false }: { src: string | null; name: string; compact?: boolean }) {
  const sizeClass = compact ? "h-7 w-7" : "h-10 w-10";

  if (src) {
    return <Image src={src} alt="" width={compact ? 28 : 40} height={compact ? 28 : 40} className={cn(sizeClass, "shrink-0 object-contain")} />;
  }

  return (
    <span className={cn("flex shrink-0 items-center justify-center bg-[#F7F8F9] text-[#2E8F7D]", sizeClass)} aria-label={name}>
      <MosqueIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

function MosqueIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.5v2.2" />
      <circle cx="12" cy="2" r="0.6" fill="currentColor" stroke="none" />
      <path d="M7.2 10.5a4.8 4.8 0 0 1 9.6 0" />
      <path d="M4.5 20.5v-7a1.6 1.6 0 0 1 3.2 0v7" />
      <path d="M16.3 20.5v-7a1.6 1.6 0 0 1 3.2 0v7" />
      <path d="M7.2 20.5v-10h9.6v10" />
      <path d="M10.5 20.5v-4a1.5 1.5 0 0 1 3 0v4" />
    </svg>
  );
}

// Returns null for "no letter to show" (guest, or a signed-in session whose
// role couldn't be matched) so the caller can render a neutral icon instead
// of ever falling back to a "?" character.
function getAccountInitial(access: UserAccess, session: Session | null): string | null {
  if (!session) {
    return null;
  }

  if (access.isMosqueAdmin) {
    return "A";
  }

  if (access.isTeacher) {
    return "T";
  }

  if (access.isParent) {
    return "P";
  }

  if (access.isStudent) {
    return "S";
  }

  return null;
}

function GuestProfileIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c1-3.2 3.2-5 6.5-5s5.5 1.8 6.5 5" />
    </svg>
  );
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
