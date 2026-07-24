import { AppChrome } from "@/components/layout/page-shell";

// Mirrors portal/layout.tsx and teacher/layout.tsx: admin previously had no persistent
// layout, so every one of its ~14 pages called PageShell itself, remounting the chrome
// (top bar/bottom nav/sidebar) on every navigation within the admin section.
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AppChrome section="admin" slug={slug}>
      {children}
    </AppChrome>
  );
}
