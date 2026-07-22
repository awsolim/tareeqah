"use client";

import { useEffect, useState } from "react";
import { AppTopBar, MobileBottomNav } from "@/components/layout/app-top-bar";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { NavItem } from "@/components/layout/horizontal-nav";
import { PageTransitionFrame } from "@/components/layout/page-transition-frame";
import { masjid } from "@/lib/mock-data";
import { getCachedSessionSnapshot, getCachedUserAccess, loadCachedSession, loadCachedUserAccess, subscribeCachedSession } from "@/lib/client-cache";

// Routes like /m/[slug]/programs and /m/[slug]/programs/[programId] are shared by guests
// AND signed-in users (deep-linked from the portal). They're passed section="public" since
// that's correct for guests, but a signed-in viewer should see their real role's chrome
// instead of the guest nav — otherwise "Classes" sends them to the guest flat list and the
// tabbed portal/teacher/admin chrome disappears even though their session is still valid.
function useEffectiveSection(slug: string, requestedSection: "public" | "portal" | "teacher" | "admin") {
  const [effectiveSection, setEffectiveSection] = useState(requestedSection);

  useEffect(() => {
    if (requestedSection !== "public") {
      setEffectiveSection(requestedSection);
      return;
    }

    let cancelled = false;

    function applyAccessForSession(userId: string | undefined) {
      if (!userId) {
        if (!cancelled) setEffectiveSection("public");
        return;
      }
      const cachedAccess = getCachedUserAccess(slug, userId);
      if (cachedAccess) {
        applyAccess(cachedAccess);
      }
      loadCachedUserAccess(slug, userId).then((access) => {
        if (!cancelled) applyAccess(access);
      });
    }

    function applyAccess(access: ReturnType<typeof getCachedUserAccess>) {
      if (cancelled || !access) return;
      if (access.isMosqueAdmin) setEffectiveSection("admin");
      else if (access.isTeacher) setEffectiveSection("teacher");
      else if (access.isStudent || access.isParent) setEffectiveSection("portal");
      else setEffectiveSection("public");
    }

    const cachedSession = getCachedSessionSnapshot();
    applyAccessForSession(cachedSession?.user.id);

    loadCachedSession().then((session) => {
      if (!cancelled) applyAccessForSession(session?.user.id);
    });

    const unsubscribe = subscribeCachedSession((session) => {
      applyAccessForSession(session?.user.id);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [slug, requestedSection]);

  return effectiveSection;
}

export function AppChrome({
  children,
  section: requestedSection = "public",
  navItems,
  mobileNavItems,
  slug,
}: {
  children: React.ReactNode;
  section?: "public" | "portal" | "teacher" | "admin";
  navItems?: NavItem[];
  mobileNavItems?: NavItem[];
  slug: string;
}) {
  const section = useEffectiveSection(slug, requestedSection);
  const scopedPublicNav = [
    { label: "Home", href: `/m/${slug}` },
    { label: "Classes", href: `/m/${slug}/programs` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/account` },
  ];
  const scopedPublicMobileNav = [
    { label: "Home", href: `/m/${slug}` },
    { label: "Classes", href: `/m/${slug}/programs` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/account` },
  ];
  const scopedPortalNav = [
    { label: "Home", href: `/m/${slug}/portal` },
    { label: "Classes", href: `/m/${slug}/portal/classes` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/portal/account` },
  ];
  const scopedPortalMobileNav = [
    { label: "Home", href: `/m/${slug}/portal` },
    { label: "Classes", href: `/m/${slug}/portal/classes` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/portal/account` },
  ];
  const scopedTeacherNav = [
    { label: "Home", href: `/m/${slug}/teacher` },
    { label: "Classes", href: `/m/${slug}/teacher/classes` },
    { label: "Inbox", href: `/m/${slug}/teacher/inbox` },
    { label: "Me", href: `/m/${slug}/teacher/account` },
  ];
  const scopedTeacherMobileNav = [
    { label: "Home", href: `/m/${slug}/teacher` },
    { label: "Classes", href: `/m/${slug}/teacher/classes` },
    { label: "Inbox", href: `/m/${slug}/teacher/inbox` },
    { label: "Me", href: `/m/${slug}/teacher/account` },
  ];
  const scopedAdminNav = [
    { label: "Home", href: `/m/${slug}/admin` },
    { label: "Classes", href: `/m/${slug}/admin/programs` },
    { label: "Masjid", href: `/m/${slug}/admin/masjid` },
    { label: "Me", href: `/m/${slug}/admin/settings` },
  ];
  const scopedAdminMobileNav = [
    { label: "Home", href: `/m/${slug}/admin` },
    { label: "Classes", href: `/m/${slug}/admin/programs` },
    { label: "Masjid", href: `/m/${slug}/admin/masjid` },
    { label: "Me", href: `/m/${slug}/admin/settings` },
  ];

  const resolvedNav = navItems ?? (section === "portal" ? scopedPortalNav : section === "teacher" ? scopedTeacherNav : section === "admin" ? scopedAdminNav : scopedPublicNav);
  const resolvedMobileNav =
    mobileNavItems ??
    (section === "portal" ? scopedPortalMobileNav : section === "teacher" ? scopedTeacherMobileNav : section === "admin" ? scopedAdminMobileNav : scopedPublicMobileNav);
  return (
    <>
      <AppTopBar appName={masjid.name} mosqueSlug={slug} homeHref={`/m/${slug}`} navItems={resolvedNav} mobileNavItems={resolvedMobileNav} />
      <MobileBottomNav mosqueSlug={slug} navItems={resolvedNav} mobileNavItems={resolvedMobileNav} />
      <DesktopSidebar appName={masjid.name} mosqueSlug={slug} homeHref={`/m/${slug}`} navItems={resolvedNav} mobileNavItems={resolvedMobileNav} section={section} />
      <div className="md:min-h-screen md:bg-[var(--workspace)] md:pl-72">
        <div className="md:min-h-screen md:overflow-hidden md:bg-transparent">
          <PageTransitionFrame>{children}</PageTransitionFrame>
        </div>
      </div>
    </>
  );
}

export function PageShell(props: {
  children: React.ReactNode;
  section?: "public" | "portal" | "teacher" | "admin";
  navItems?: NavItem[];
  mobileNavItems?: NavItem[];
  slug: string;
}) {
  return <AppChrome {...props} />;
}
