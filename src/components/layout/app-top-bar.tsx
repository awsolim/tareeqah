"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthStatusActions } from "@/components/auth/auth-status-actions";
import { useStudentNotificationCounts, useTeacherNotificationCounts } from "@/components/data/supabase-public-sections";
import { HorizontalNav, NavItem } from "@/components/layout/horizontal-nav";
import { getCachedMosqueChrome, loadMosqueChrome } from "@/lib/client-cache";
import { cn } from "@/lib/utils";

function BottomNav({ items, inboxBadgeCount = 0 }: { items: NavItem[]; inboxBadgeCount?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingNavigation, setPendingNavigation] = useState<{ href: string; fromPath: string } | null>(null);
  const itemByLabel = new Map(items.map((item) => [item.label, item]));
  const visibleItems = ["Home", "Classes", "Inbox", "Me"]
    .map((label) => itemByLabel.get(label))
    .filter((item): item is NavItem => Boolean(item));
  const currentIndex = visibleItems.findIndex((item) => isNavItemActive(pathname, item));

  useEffect(() => {
    for (const item of items) {
      router.prefetch(item.href);
    }
  }, [items, router]);

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
      setPendingNavigation({ href, fromPath: pathname });
      router.push(href);
    }
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D6DCE0] bg-[var(--workspace)] md:hidden" aria-label="Mobile primary navigation">
      <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}>
        {visibleItems.map((item, index) => {
          const pendingHref = pendingNavigation?.fromPath === pathname ? pendingNavigation.href : null;
          const active = pendingHref ? pendingHref === item.href : isNavItemActive(pathname, item);
          const badgeCount = item.label === "Inbox" ? inboxBadgeCount : 0;
          return (
            <Link
              key={`${item.label}-${item.href}`}
              href={item.href}
              onClick={(event) => {
                if (pathname === item.href) {
                  return;
                }

                event.preventDefault();
                beginNavigation(index, item);
              }}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-[#6B747B]",
                active && "text-[#2F8FB3]",
              )}
            >
              <span
                className={cn(
                  "relative flex h-8 min-w-12 items-center justify-center rounded-full px-3",
                  active && "bg-[#E7F3F8]",
                )}
                aria-hidden
              >
                <NavIcon label={item.label} />
                {badgeCount ? <NavBadge count={badgeCount} /> : null}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
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

function NavIcon({ label }: { label: string }) {
  const className = "h-5 w-5";

  if (label === "Home") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 11.5 12 4l8.5 7.5" />
        <path d="M6.5 10.5V20h11v-9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    );
  }

  if (label === "Classes") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="13" rx="1.5" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
        <path d="M6.5 20h11" />
      </svg>
    );
  }

  if (label === "Inbox") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16v12H4z" />
        <path d="m4 8 8 6 8-6" />
      </svg>
    );
  }

  if (label === "Me") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19c1-3.2 3.2-5 6.5-5s5.5 1.8 6.5 5" />
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
  const [displayName, setDisplayName] = useState(
    mosqueSlug ? titleFromSlug(mosqueSlug) : appName
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const portalInboxHref = mosqueSlug ? `/m/${mosqueSlug}/portal/announcements` : "";
  const teacherInboxHref = mosqueSlug ? `/m/${mosqueSlug}/teacher/inbox` : "";
  const showStudentBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === portalInboxHref));
  const showTeacherBadges = Boolean((mobileNavItems ?? navItems).some((item) => item.label === "Inbox" && item.href === teacherInboxHref));
  const { totalCount: studentTotalCount } = useStudentNotificationCounts(showStudentBadges ? (mosqueSlug ?? "") : "");
  const { totalCount: teacherTotalCount } = useTeacherNotificationCounts(showTeacherBadges ? (mosqueSlug ?? "") : "");
  const inboxBadgeCount = showStudentBadges ? studentTotalCount : showTeacherBadges ? teacherTotalCount : 0;

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




  return (
    <header className="sticky top-0 z-30 border-b border-[#D6DCE0] bg-[var(--workspace)] text-[#26323A] md:hidden">
      <div className="app-container flex min-h-16 items-center justify-between gap-3 py-2">
        <Link href={homeHref} className="flex min-w-0 items-center gap-3">
          <TopBarLogo src={logoUrl} name={displayName} />
          <span className="min-w-0">
            <span className="block truncate text-xl font-medium leading-6 text-[#26323A]">{displayName}</span>
            <span className="block truncate text-xs leading-4 text-[#6B747B]">Powered by Tareeqah</span>
          </span>
        </Link>
        <HorizontalNav items={navItems} />
        <div className="flex items-center gap-2 md:hidden">
          <AuthStatusActions loginHref={`${homeHref}/login`} mosqueSlug={mosqueSlug ?? ""} />
        </div>
        <div className="hidden md:block">
          <AuthStatusActions loginHref={`${homeHref}/login`} mosqueSlug={mosqueSlug ?? ""} />
        </div>
      </div>
      <BottomNav items={mobileNavItems ?? navItems} inboxBadgeCount={inboxBadgeCount} />
    </header>
  );
}

function TopBarLogo({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-sm border border-[#D6DCE0] object-contain" />;
  }

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#D6DCE0] bg-[#F7F8F9] text-sm font-medium text-[#2E8F7D]">
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
