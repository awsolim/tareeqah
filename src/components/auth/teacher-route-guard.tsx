"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadCachedSession, loadCachedUserAccess } from "@/lib/client-cache";

export function TeacherRouteGuard({ children, slug }: { children: React.ReactNode; slug: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    let active = true;

    async function guardRoute() {
      const session = await loadCachedSession();
      if (!active) {
        return;
      }

      if (!session?.user.id) {
        router.replace(`/m/${slug}/login`);
        return;
      }

      const access = await loadCachedUserAccess(slug, session.user.id);
      if (!active) {
        return;
      }

      const accountType = access.accountType?.toLowerCase() ?? null;
      if (accountType === "teacher" || accountType === "admin" || access.isTeacher || access.isMosqueAdmin) {
        setIsAllowed(true);
        return;
      }

      router.replace(mapTeacherPathToPortal(pathname, slug));
    }

    void guardRoute();

    return () => {
      active = false;
    };
  }, [pathname, router, slug]);

  if (!isAllowed) {
    return null;
  }

  return <>{children}</>;
}

function mapTeacherPathToPortal(pathname: string | null, slug: string) {
  const base = `/m/${slug}`;
  const path = pathname ?? `${base}/teacher`;

  if (path === `${base}/teacher`) {
    return `${base}/portal`;
  }

  if (path === `${base}/teacher/account`) {
    return `${base}/portal/account`;
  }

  if (path === `${base}/teacher/inbox`) {
    return `${base}/portal/announcements`;
  }

  if (path.startsWith(`${base}/teacher/classes`)) {
    const classPath = path.replace(`${base}/teacher/classes`, `${base}/portal/classes`);
    return classPath.replace(/\/(students|announcement)$/, "");
  }

  return `${base}/portal`;
}
