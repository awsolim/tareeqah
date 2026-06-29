"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getDefaultLandingHref, loadUserAccessByMosqueSlug } from "@/lib/authz";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function GoogleAuthCallback({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(searchParams.get("error_description") ?? searchParams.get("error"));

  useEffect(() => {
    if (handledRef.current || error) {
      return;
    }

    handledRef.current = true;

    async function finishSignIn() {
      const supabase = createSupabaseBrowserClient();
      const code = searchParams.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            throw exchangeError;
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw new Error("Could not finish Google sign in.");
      }

      const access = await loadUserAccessByMosqueSlug(slug);
      if (!access.profileId || !access.accountType || (!access.isStudent && !access.isParent && !access.isTeacher && !access.isMosqueAdmin)) {
        router.replace(`/m/${slug}/auth/complete-profile`);
        return;
      }

      router.replace(getDefaultLandingHref(slug, access));
      router.refresh();
    }

    finishSignIn().catch((callbackError: unknown) => {
      setError(callbackError instanceof Error ? callbackError.message : "Could not finish Google sign in.");
    });
  }, [error, router, searchParams, slug]);

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-[28px] bg-white p-6 text-center shadow-[0_18px_44px_rgba(38,50,58,0.08)]">
          <p className="text-lg font-semibold text-[#26323A]">Google sign in did not finish</p>
          <p className="mt-2 text-sm text-[#6B747B]">{error}</p>
          <Link href={`/m/${slug}/login`} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[#2F6B53] px-6 text-sm font-semibold text-white">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[240px] items-center justify-center p-6">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" />
    </div>
  );
}
