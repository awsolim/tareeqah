"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadCachedSession, loadCachedUserAccess } from "@/lib/client-cache";

export function PortalRoleRedirect({
  slug,
  teacherHref,
  adminHref,
  children,
}: {
  slug: string;
  teacherHref: string;
  adminHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveRoute() {
      const session = await loadCachedSession();
      if (!session?.user.id) {
        if (!cancelled) {
          setShouldRender(true);
        }
        return;
      }

      const access = await loadCachedUserAccess(slug, session.user.id);
      const accountType = access.accountType?.toLowerCase() ?? null;

      if (accountType === "teacher" || access.isTeacher) {
        router.replace(teacherHref);
        return;
      }

      if (accountType === "admin" || access.isMosqueAdmin) {
        router.replace(adminHref);
        return;
      }

      if (!cancelled) {
        setShouldRender(true);
      }
    }

    resolveRoute();

    return () => {
      cancelled = true;
    };
  }, [adminHref, router, slug, teacherHref]);

  if (!shouldRender) {
    return null;
  }

  return <>{children}</>;
}
