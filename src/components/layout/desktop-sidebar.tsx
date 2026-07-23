"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useStudentNotificationCounts, useTeacherNotificationCounts } from "@/components/data/supabase-public-sections";
import type { NavItem } from "@/components/layout/horizontal-nav";
import { emptyUserAccess, getAccountLabel, type UserAccess } from "@/lib/authz";
import {
  getCachedMosqueChrome,
  getCachedProfileSummary,
  getCachedSessionSnapshot,
  getCachedUserAccess,
  loadCachedSession,
  loadCachedProfileSummary,
  loadCachedUserAccess,
  loadMosqueChrome,
  performClientLogout,
  subscribeCachedSession,
} from "@/lib/client-cache";
import { cn } from "@/lib/utils";

export function DesktopSidebar({
  appName,
  mosqueSlug,
  homeHref,
  navItems,
  mobileNavItems,
  section = "public",
}: {
  appName: string;
  mosqueSlug: string;
  homeHref: string;
  navItems: NavItem[];
  mobileNavItems?: NavItem[];
  section?: "public" | "portal" | "teacher" | "admin";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const whiteChrome = /\/teacher\/classes\/[^/]+\/instructors$/.test(pathname);

  const [displayName, setDisplayName] = useState(titleFromSlug(mosqueSlug) || appName);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const portalInboxHref = `/m/${mosqueSlug}/portal/announcements`;
  const teacherInboxHref = `/m/${mosqueSlug}/teacher/inbox`;
  const showStudentBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === portalInboxHref));
  const showTeacherBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === teacherInboxHref));
  const { totalCount: studentTotalCount, actionRequired: studentActionRequired } = useStudentNotificationCounts(showStudentBadges ? mosqueSlug : "");
  const { totalCount: teacherTotalCount, actionRequired: teacherActionRequired } = useTeacherNotificationCounts(showTeacherBadges ? mosqueSlug : "");
  const inboxBadgeCount = showStudentBadges ? studentTotalCount : showTeacherBadges ? teacherTotalCount : 0;
  const inboxActionRequired = showStudentBadges ? studentActionRequired : showTeacherBadges ? teacherActionRequired : false;

  const visibleItems = useMemo(() => buildDesktopItems(section, mosqueSlug), [section, mosqueSlug]);
  const accountHref = accountHrefForSection(section, mosqueSlug);

  useEffect(() => {
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
  }, [mosqueSlug]);

  return (
    <aside className={cn("fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-[#D6DCE0] px-5 py-6 text-[#26323A] md:flex", whiteChrome ? "bg-white" : "bg-[var(--workspace)]")}>
      <Link href={homeHref} className="flex min-w-0 items-center gap-3">
        <SidebarLogo src={logoUrl} name={displayName} />
        <span className="min-w-0">
          <span className="block truncate text-xl font-semibold leading-6">{displayName}</span>
          <span className="block truncate text-xs leading-4 text-[#6B747B]">Powered by Tareeqah</span>
        </span>
      </Link>

      <nav className="mt-10 space-y-1" aria-label="Primary navigation">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8A9399]">Workspace</p>

        {visibleItems.map((item) => {
          const active = isNavItemActive(pathname, item);
          const isInboxItem = item.label === "Inbox" || item.label === "Announcements";
          const badgeCount = isInboxItem ? inboxBadgeCount : 0;
          const actionRequired = isInboxItem ? inboxActionRequired : false;
          const label = desktopLabel(item.label);
          const subItems = buildDesktopSubItems(label, section, mosqueSlug, accountHref);
          const subItemActive = subItems.some((subItem) => isHrefActive(pathname, searchParams, subItem.href));

          if (label === "Me" || subItems.length) {
            return (
              <DesktopNavGroup key={`${item.label}-${item.href}`} item={item} active={active || subItemActive} badgeCount={badgeCount} actionRequired={actionRequired}>
                {label === "Me" ? (
                  <DesktopAccountSubnav mosqueSlug={mosqueSlug} accountHref={accountHref} />
                ) : (
                  <DesktopSidebarSubnav items={subItems} pathname={pathname} searchParams={searchParams} />
                )}
              </DesktopNavGroup>
            );
          }

          return (
            <Link
              key={`${item.label}-${item.href}`}
              href={item.href}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-[#5B6770] transition-colors hover:bg-[#F1F5F6] hover:text-[#26323A]",
                active && "bg-[#E8F5F1] text-[#17624F]",
              )}
            >
              <SidebarIcon label={item.label} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <Badge count={badgeCount} actionRequired={actionRequired} />
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8A9399]">Account</p>
        <DesktopProfileLink mosqueSlug={mosqueSlug} accountHref={accountHref} />
      </div>
    </aside>
  );
}

function DesktopNavGroup({ item, active, badgeCount, actionRequired = false, children }: { item: NavItem; active: boolean; badgeCount: number; actionRequired?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active);
  const label = desktopLabel(item.label);

  useEffect(() => {
    if (active) {
      setOpen(true);
    }
  }, [active]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-semibold text-[#5B6770] transition-colors hover:bg-[#F1F5F6] hover:text-[#26323A]",
          active && "bg-[#E8F5F1] text-[#17624F]",
        )}
        aria-expanded={open}
      >
        <SidebarIcon label={item.label} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Badge count={badgeCount} actionRequired={actionRequired} />
        <SidebarChevron expanded={open} />
      </button>
      {open ? <div className="mt-1 border-l border-[#D6DCE0] pl-4">{children}</div> : null}
    </div>
  );
}

type SearchParamReader = Pick<URLSearchParams, "get">;

function DesktopSidebarSubnav({ items, pathname, searchParams }: { items: Array<{ label: string; href: string }>; pathname: string; searchParams: SearchParamReader }) {
  return (
    <div>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-[#6B747B] transition-colors hover:bg-[#F1F5F6] hover:text-[#26323A]",
            isHrefActive(pathname, searchParams, item.href) && "bg-[#F3FAF7] text-[#17624F]",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

const accountPanelItems = [
  { label: "Account Settings", panel: "settings" },
  { label: "Family", panel: "family", parentOnly: true },
  { label: "Billing", panel: "billing" },
  { label: "Privacy and Security", panel: "security" },
  { label: "Add App to Homescreen", panel: "homescreen" },
  { label: "Switch Account", panel: "switchAccount" },
] as const;

function useHasMounted() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted;
}

function DesktopProfileLink({ mosqueSlug, accountHref }: { mosqueSlug: string; accountHref: string }) {
  const cachedSession = getCachedSessionSnapshot();
  const [session, setSession] = useState<Session | null | undefined>(cachedSession);
  const [access, setAccess] = useState<UserAccess>(() =>
    cachedSession?.user.id ? getCachedUserAccess(mosqueSlug, cachedSession.user.id) ?? emptyUserAccess : emptyUserAccess,
  );
  const [profileName, setProfileName] = useState<string | null>(() => {
    const summary = cachedSession?.user.id ? getCachedProfileSummary(cachedSession.user.id) : undefined;
    return summary?.fullName ?? cachedSession?.user.user_metadata?.full_name ?? null;
  });
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(() => {
    const summary = cachedSession?.user.id ? getCachedProfileSummary(cachedSession.user.id) : undefined;
    return summary?.avatarUrl ?? cachedSession?.user.user_metadata?.avatar_url ?? null;
  });
  const [resolved, setResolved] = useState(() => {
    if (cachedSession === null) return true;
    return Boolean(cachedSession?.user.id && getCachedProfileSummary(cachedSession.user.id));
  });

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeCachedSession((nextSession) => {
      setSession(nextSession);

      if (!nextSession) {
        setAccess(emptyUserAccess);
        setProfileName(null);
        setProfileAvatarUrl(null);
        setResolved(true);
      } else {
        setResolved(false);
      }
    });

    loadCachedSession().then((nextSession) => {
      if (!cancelled) {
        setSession(nextSession);

        if (!nextSession) {
          setAccess(emptyUserAccess);
          setProfileName(null);
          setProfileAvatarUrl(null);
          setResolved(true);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session?.user.id) {
      return () => {
        cancelled = true;
      };
    }

    Promise.all([loadCachedUserAccess(mosqueSlug, session.user.id), loadCachedProfileSummary(session.user.id)]).then(([nextAccess, profileSummary]) => {
      if (!cancelled) {
        setAccess(nextAccess);
        setProfileName(profileSummary.fullName ?? session.user.user_metadata?.full_name ?? null);
        setProfileAvatarUrl(profileSummary.avatarUrl ?? session.user.user_metadata?.avatar_url ?? null);
        setResolved(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mosqueSlug, session]);

  const ready = session !== undefined && (session === null || resolved);
  const displayName = profileName || session?.user.email?.replace(/@.*/, "") || "Guest";
  const label = session ? getAccountLabel(access) : "Not signed in";

  if (!ready) {
    return (
      <div className="flex min-h-16 items-center gap-3 rounded-3xl bg-[#F5F7F8] px-3 py-3">
        <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[#E1E8EC]" />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block h-3.5 w-24 animate-pulse rounded bg-[#E1E8EC]" />
          <span className="block h-3 w-16 animate-pulse rounded bg-[#E1E8EC]" />
        </span>
      </div>
    );
  }

  return (
    <Link href={accountHref} className="flex min-h-16 items-center gap-3 rounded-3xl bg-[#F5F7F8] px-3 py-3 transition-colors hover:bg-[#EEF4F5]">
      {profileAvatarUrl ? (
        <span className="h-11 w-11 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: `url("${profileAvatarUrl}")` }} aria-hidden />
      ) : session === null ? (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E5F3EF] text-[#17624F]">
          <GuestProfileIcon className="h-5 w-5" />
        </span>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E5F3EF] text-sm font-semibold text-[#17624F]">
          {initials(displayName)}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[#26323A]">{displayName}</span>
        <span className="block truncate text-xs text-[#6B747B]">{label}</span>
      </span>
    </Link>
  );
}

function GuestProfileIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c1-3.2 3.2-5 6.5-5s5.5 1.8 6.5 5" />
    </svg>
  );
}

function DesktopAccountSubnav({ mosqueSlug, accountHref }: { mosqueSlug: string; accountHref: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasMounted = useHasMounted();

  const cachedSession = getCachedSessionSnapshot();
  const [session, setSession] = useState<Session | null>(cachedSession ?? null);
  const [sessionResolved, setSessionResolved] = useState(cachedSession !== undefined);
  const [access, setAccess] = useState<UserAccess>(() =>
    cachedSession?.user.id ? getCachedUserAccess(mosqueSlug, cachedSession.user.id) ?? emptyUserAccess : emptyUserAccess,
  );

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeCachedSession((nextSession) => {
      setSession(nextSession);
      setSessionResolved(true);

      if (!nextSession) {
        setAccess(emptyUserAccess);
      }
    });

    loadCachedSession().then((nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
        setSessionResolved(true);

        if (!nextSession) {
          setAccess(emptyUserAccess);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session?.user.id) {
      return () => {
        cancelled = true;
      };
    }

    loadCachedUserAccess(mosqueSlug, session.user.id).then((nextAccess) => {
      if (!cancelled) {
        setAccess(nextAccess);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mosqueSlug, session]);

  if (!hasMounted) {
    return null;
  }

  if (sessionResolved && !session) {
    return null;
  }

  const currentPanel = searchParams.get("panel") ?? "settings";
  const items = accountPanelItems.filter((item) => !("parentOnly" in item) || access.accountType === "parent");

  return (
    <div className="mt-2 border-l border-[#D6DCE0] pl-4">
      {items.map((item) => {
        const href = `${accountHref}?panel=${item.panel}`;
        const active = currentPanel === item.panel;

        return (
          <Link
            key={item.panel}
            href={href}
            onMouseEnter={() => router.prefetch(href)}
            className={cn(
              "flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-[#6B747B] transition-colors hover:bg-[#F1F5F6] hover:text-[#26323A]",
              active && "bg-[#F3FAF7] text-[#17624F]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => {
          router.replace(`/m/${mosqueSlug}/login`);
          void performClientLogout();
        }}
        className="flex min-h-9 w-full items-center rounded-xl px-3 text-left text-sm font-medium text-[#C0392B] transition-colors hover:bg-[#FDF1F0]"
      >
        Log out
      </button>
    </div>
  );
}

function buildDesktopItems(section: "public" | "portal" | "teacher" | "admin", mosqueSlug: string): NavItem[] {
  if (section === "teacher") {
    return [
      { label: "Home", href: `/m/${mosqueSlug}/teacher` },
      { label: "Classes", href: `/m/${mosqueSlug}/teacher/classes` },
      { label: "Inbox", href: `/m/${mosqueSlug}/teacher/inbox` },
      { label: "Me", href: `/m/${mosqueSlug}/teacher/account` },
    ];
  }

  if (section === "admin") {
    return [
      { label: "Home", href: `/m/${mosqueSlug}/admin` },
      { label: "Classes", href: `/m/${mosqueSlug}/admin/programs` },
      { label: "Masjid", href: `/m/${mosqueSlug}/admin/masjid` },
      { label: "Me", href: `/m/${mosqueSlug}/admin/settings` },
    ];
  }

  if (section === "portal") {
    return [
      { label: "Home", href: `/m/${mosqueSlug}/portal` },
      { label: "Classes", href: `/m/${mosqueSlug}/portal/classes` },
      { label: "Inbox", href: `/m/${mosqueSlug}/portal/announcements` },
      { label: "Me", href: `/m/${mosqueSlug}/portal/account` },
    ];
  }

  return [
    { label: "Home", href: `/m/${mosqueSlug}` },
    { label: "Classes", href: `/m/${mosqueSlug}/programs` },
    { label: "Inbox", href: `/m/${mosqueSlug}/portal/announcements` },
    { label: "Me", href: `/m/${mosqueSlug}/account` },
  ];
}

function buildDesktopSubItems(label: string, section: "public" | "portal" | "teacher" | "admin", mosqueSlug: string, accountHref: string) {
  const base = `/m/${mosqueSlug}`;

  if (label === "Classes") {
    if (section === "teacher") {
      return [
        { label: "My Classes", href: `${base}/teacher/classes?tab=mine` },
        { label: "Other Classes", href: `${base}/teacher/classes?tab=other` },
      ];
    }
    if (section === "portal") {
      return [
        { label: "My Classes", href: `${base}/portal/classes?tab=classes` },
        { label: "My Applications", href: `${base}/portal/classes?tab=applications` },
        { label: "Browse", href: `${base}/portal/classes?tab=browse` },
      ];
    }
    if (section === "admin") {
      return [{ label: "All Classes", href: `${base}/admin/programs` }];
    }
    return [{ label: "Browse Classes", href: `${base}/programs` }];
  }

  if (label === "Inbox") {
    if (section === "teacher") {
      return [
        { label: "Applications", href: `${base}/teacher/inbox?tab=requests` },
        { label: "Withdrawals", href: `${base}/teacher/inbox?tab=withdrawals` },
        { label: "Instructors", href: `${base}/teacher/inbox?tab=instructors` },
      ];
    }
    return [
      { label: "Announcements", href: `${base}/portal/announcements?tab=announcements` },
      { label: "Notes", href: `${base}/portal/announcements?tab=notes` },
      { label: "Applications", href: `${base}/portal/announcements?tab=requests` },
    ];
  }

  if (label === "Me") {
    return accountPanelItems.map((item) => ({ label: item.label, href: `${accountHref}?panel=${item.panel}` }));
  }

  return [];
}

function accountHrefForSection(section: "public" | "portal" | "teacher" | "admin", mosqueSlug: string) {
  const base = `/m/${mosqueSlug}`;

  if (section === "teacher") {
    return `${base}/teacher/account`;
  }

  if (section === "admin") {
    return `${base}/admin/settings`;
  }

  if (section === "portal") {
    return `${base}/portal/account`;
  }

  return `${base}/account`;
}

function desktopLabel(label: string) {
  if (label === "Dashboard") {
    return "Home";
  }

  if (label === "Announcements") {
    return "Inbox";
  }

  if (label === "Programs") {
    return "Classes";
  }

  if (label === "Account") {
    return "Me";
  }

  return label;
}

function isNavItemActive(pathname: string, item: NavItem) {
  const hrefPath = item.href.split("?")[0];

  return pathname === hrefPath || (item.label !== "Home" && pathname.startsWith(`${hrefPath}/`));
}

function isHrefActive(pathname: string, searchParams: SearchParamReader, href: string) {
  const [hrefPath, queryString] = href.split("?");
  if (pathname !== hrefPath) {
    return false;
  }
  if (!queryString) {
    return true;
  }
  const hrefParams = new URLSearchParams(queryString);
  for (const [key, value] of hrefParams.entries()) {
    if (searchParams.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function Badge({ count, actionRequired = false }: { count?: number; actionRequired?: boolean }) {
  if (actionRequired) {
    return <span className="h-3 w-3 rounded-full bg-[#2F8FB3]" />;
  }
  if (count) {
    return <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E25241] px-1 text-[11px] font-semibold leading-none text-white">{count > 9 ? "9+" : count}</span>;
  }
  return null;
}

function SidebarLogo({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl object-contain" />;
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F7F8F9] text-[#2E8F7D]" aria-label={name}>
      <MosqueIcon className="h-6 w-6" />
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

function SidebarIcon({ label }: { label: string }) {
  const className = "h-5 w-5";
  const normalized = desktopLabel(label);

  if (normalized === "Home") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3.5 11.5 12 4l8.5 7.5" />
        <path d="M6.5 10.5V20h11v-9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    );
  }

  if (normalized === "Classes" || normalized === "Programs") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="4" y="5" width="16" height="13" rx="1.5" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    );
  }

  if (normalized === "Inbox") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 6h16v12H4z" />
        <path d="m4 8 8 6 8-6" />
      </svg>
    );
  }

  if (normalized === "Masjid") {
    return <MosqueIcon className={className} />;
  }

  if (normalized === "Me" || normalized === "Settings") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19c1-3.2 3.2-5 6.5-5s5.5 1.8 6.5 5" />
      </svg>
    );
  }

  return <span className="flex h-5 w-5 items-center justify-center text-xs font-semibold">{normalized[0]}</span>;
}

function SidebarChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
