import { TeacherRouteGuard } from "@/components/auth/teacher-route-guard";
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
    <TeacherRouteGuard slug={slug}>
      <AppChrome section="teacher" slug={slug}>
        {children}
      </AppChrome>
    </TeacherRouteGuard>
  );
}
