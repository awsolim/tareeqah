import { AppTopBar } from "@/components/layout/app-top-bar";
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
    { label: "Inbox", href: `/m/${slug}/admin/enrollments` },
    { label: "Me", href: `/m/${slug}/admin/settings` },
  ];
  const scopedAdminMobileNav = [
    { label: "Home", href: `/m/${slug}/admin` },
    { label: "Classes", href: `/m/${slug}/admin/programs` },
    { label: "Inbox", href: `/m/${slug}/admin/enrollments` },
    { label: "Me", href: `/m/${slug}/admin/settings` },
  ];

  const resolvedNav = navItems ?? (section === "portal" ? scopedPortalNav : section === "teacher" ? scopedTeacherNav : section === "admin" ? scopedAdminNav : scopedPublicNav);
  const resolvedMobileNav =
    mobileNavItems ??
    (section === "portal" ? scopedPortalMobileNav : section === "teacher" ? scopedTeacherMobileNav : section === "admin" ? scopedAdminMobileNav : scopedPublicMobileNav);
  return (
    <>
      <AppTopBar appName={masjid.name} mosqueSlug={slug} homeHref={`/m/${slug}`} navItems={resolvedNav} mobileNavItems={resolvedMobileNav} />
      <DesktopSidebar appName={masjid.name} mosqueSlug={slug} homeHref={`/m/${slug}`} navItems={resolvedNav} mobileNavItems={resolvedMobileNav} section={section} />
      <div className="md:min-h-screen md:bg-[var(--workspace)] md:py-6 md:pl-72 md:pr-6">
        <div className="md:mx-auto md:min-h-[calc(100vh-3rem)] md:max-w-[1480px] md:overflow-hidden md:rounded-[32px] md:bg-[#F6F8FA] md:shadow-[0_24px_70px_rgba(38,50,58,0.18)] md:ring-1 md:ring-white/70">
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
