"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useStudentNotificationCounts, useTeacherNotificationCounts } from "@/components/data/supabase-public-sections";
import type { NavItem } from "@/components/layout/horizontal-nav";
import { emptyUserAccess, getAccountLabel, type UserAccess } from "@/lib/authz";
import {
  getCachedMosqueChrome,
  loadCachedSession,
  loadCachedProfileSummary,
  loadCachedUserAccess,
  loadMosqueChrome,
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
  const whiteChrome = /\/teacher\/classes\/[^/]+\/instructors$/.test(pathname);

  const [displayName, setDisplayName] = useState(titleFromSlug(mosqueSlug) || appName);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const portalInboxHref = `/m/${mosqueSlug}/portal/announcements`;
  const teacherInboxHref = `/m/${mosqueSlug}/teacher/inbox`;
  const showStudentBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === portalInboxHref));
  const showTeacherBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === teacherInboxHref));
  const { totalCount: studentTotalCount } = useStudentNotificationCounts(showStudentBadges ? mosqueSlug : "");
  const { totalCount: teacherTotalCount } = useTeacherNotificationCounts(showTeacherBadges ? mosqueSlug : "");
  const inboxBadgeCount = showStudentBadges ? studentTotalCount : showTeacherBadges ? teacherTotalCount : 0;

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
          const badgeCount = item.label === "Inbox" || item.label === "Announcements" ? inboxBadgeCount : 0;

          return (
            <Fragment key={`${item.label}-${item.href}`}>
              <Link
                href={item.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold text-[#5B6770] transition-colors hover:bg-[#F1F5F6] hover:text-[#26323A]",
                  active && "bg-[#E8F5F1] text-[#17624F]",
                )}
              >
                <SidebarIcon label={item.label} />
                <span className="min-w-0 flex-1 truncate">{desktopLabel(item.label)}</span>
                {badgeCount ? <Badge count={badgeCount} /> : null}
              </Link>

              {desktopLabel(item.label) === "Me" ? <DesktopAccountSubnav mosqueSlug={mosqueSlug} accountHref={accountHref} /> : null}
            </Fragment>
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

const accountPanelItems = [
  { label: "Account Settings", panel: "settings" },
  { label: "Family", panel: "family", parentOnly: true },
  { label: "Billing", panel: "billing" },
  { label: "Privacy and Security", panel: "security" },
  { label: "Add App to Homescreen", panel: "homescreen" },
] as const;

function useHasMounted() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted;
}

function DesktopProfileLink({ mosqueSlug, accountHref }: { mosqueSlug: string; accountHref: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<UserAccess>(emptyUserAccess);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeCachedSession((nextSession) => {
      setSession(nextSession);

      if (!nextSession) {
        setAccess(emptyUserAccess);
        setProfileName(null);
        setProfileAvatarUrl(null);
      }
    });

    loadCachedSession().then((nextSession) => {
      if (!cancelled) {
        setSession(nextSession);

        if (!nextSession) {
          setAccess(emptyUserAccess);
          setProfileName(null);
          setProfileAvatarUrl(null);
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
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mosqueSlug, session]);

  const displayName = profileName || session?.user.email?.replace(/@.*/, "") || "Guest";
  const label = session ? getAccountLabel(access) : "Not signed in";

  return (
    <Link href={accountHref} className="flex min-h-16 items-center gap-3 rounded-3xl bg-[#F5F7F8] px-3 py-3 transition-colors hover:bg-[#EEF4F5]">
      {profileAvatarUrl ? (
        <span className="h-11 w-11 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: `url("${profileAvatarUrl}")` }} aria-hidden />
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

function DesktopAccountSubnav({ mosqueSlug, accountHref }: { mosqueSlug: string; accountHref: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasMounted = useHasMounted();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [access, setAccess] = useState<UserAccess>(emptyUserAccess);

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

  if (!pathname.startsWith(accountHref)) {
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
      { label: "Members", href: `/m/${mosqueSlug}/admin/students` },
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

function Badge({ count }: { count: number }) {
  return <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E25241] px-1 text-[11px] font-semibold leading-none text-white">{count > 9 ? "9+" : count}</span>;
}

function SidebarLogo({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl border border-[#D6DCE0] object-contain" />;
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#D6DCE0] bg-[#F7F8F9] text-sm font-semibold text-[#2E8F7D]">
      {initials(name)}
    </span>
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
