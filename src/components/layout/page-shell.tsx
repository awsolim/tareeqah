import { AppTopBar, MobileBottomNav } from "@/components/layout/app-top-bar";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { NavItem } from "@/components/layout/horizontal-nav";
import { PageTransitionFrame } from "@/components/layout/page-transition-frame";
import { masjid } from "@/lib/mock-data";

export function AppChrome({
  children,
  section = "public",
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
