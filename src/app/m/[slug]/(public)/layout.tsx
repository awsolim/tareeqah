import { AppChrome } from "@/components/layout/page-shell";

// Mirrors portal/layout.tsx, teacher/layout.tsx, admin/layout.tsx: one persistent chrome
// instance for the whole route family, so navigating between the mosque home, programs
// browse, a program's detail page, and account no longer remounts the top bar/bottom nav/
// sidebar on every hop. This is a route group (no URL segment) — /m/[slug]/programs still
// resolves exactly as before.
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AppChrome section="public" slug={slug}>
      {children}
    </AppChrome>
  );
}
