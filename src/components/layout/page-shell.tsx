import { AppTopBar } from "@/components/layout/app-top-bar";
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
    { label: "Programs", href: `/m/${slug}/programs` },
    { label: "Login", href: `/m/${slug}/login` },
    { label: "Sign Up", href: `/m/${slug}/signup` },
  ];
  const scopedPublicMobileNav = [
    { label: "Home", href: `/m/${slug}` },
    { label: "Classes", href: `/m/${slug}/programs` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/login` },
  ];
  const scopedPortalNav = [
    { label: "Dashboard", href: `/m/${slug}/portal` },
    { label: "Account", href: `/m/${slug}/portal/account` },
    { label: "My Family", href: `/m/${slug}/portal/family` },
    { label: "Classes", href: `/m/${slug}/portal/classes` },
    { label: "Schedule", href: `/m/${slug}/portal/schedule` },
    { label: "Attendance", href: `/m/${slug}/portal/attendance` },
    { label: "Announcements", href: `/m/${slug}/portal/announcements` },
  ];
  const scopedPortalMobileNav = [
    { label: "Home", href: `/m/${slug}/portal` },
    { label: "Classes", href: `/m/${slug}/portal/classes` },
    { label: "Inbox", href: `/m/${slug}/portal/announcements` },
    { label: "Me", href: `/m/${slug}/portal/account` },
  ];
  const scopedTeacherNav = [
    { label: "Home", href: `/m/${slug}/teacher` },
    { label: "Inbox", href: `/m/${slug}/teacher/inbox` },
    { label: "Classes", href: `/m/${slug}/teacher/classes` },
    { label: "Attendance", href: `/m/${slug}/teacher/attendance` },
    { label: "Students", href: `/m/${slug}/teacher/classes` },
    { label: "Actions", href: `/m/${slug}/teacher/attendance` },
  ];
  const scopedTeacherMobileNav = [
    { label: "Home", href: `/m/${slug}/teacher` },
    { label: "Classes", href: `/m/${slug}/teacher/classes` },
    { label: "Inbox", href: `/m/${slug}/teacher/inbox` },
    { label: "Me", href: `/m/${slug}/teacher/account` },
  ];
  const scopedAdminNav = [
    { label: "Dashboard", href: `/m/${slug}/admin` },
    { label: "Programs", href: `/m/${slug}/admin/programs` },
    { label: "Enrollments", href: `/m/${slug}/admin/enrollments` },
    { label: "Families", href: `/m/${slug}/admin/students` },
    { label: "Students", href: `/m/${slug}/admin/students` },
    { label: "Schedule", href: `/m/${slug}/admin` },
    { label: "Actions", href: `/m/${slug}/admin/settings` },
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
      <PageTransitionFrame>{children}</PageTransitionFrame>
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
