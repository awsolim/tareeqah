import { AppChrome } from "@/components/layout/page-shell";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AppChrome section="portal" slug={slug}>
      {children}
    </AppChrome>
  );
}
