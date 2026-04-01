import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Build the correct redirect base URL, accounting for load balancers /
 * reverse proxies (e.g. Netlify) that set x-forwarded-host.
 */
export function getRedirectBase(request: NextRequest, origin: string): string {
  const isLocalEnv = process.env.NODE_ENV === "development";
  if (isLocalEnv) return origin;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) return `https://${forwardedHost}`;

  return origin;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/";
  const slug = searchParams.get("slug");

  // Ensure `next` is always a relative path to prevent open-redirect attacks
  if (!next.startsWith("/")) {
    next = "/";
  }

  const base = getRedirectBase(request, origin);

  if (!code) {
    return NextResponse.redirect(new URL(next, base));
  }

  // Collect cookies set during the exchange so they land on the final redirect
  const responseCookies: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  // Mutable store: starts with request cookies, accumulates any cookies set by
  // the Supabase client (session tokens) so subsequent queries see them too.
  const cookieMap = new Map<string, { name: string; value: string }>();
  request.cookies.getAll().forEach((c) => cookieMap.set(c.name, c));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Array.from(cookieMap.values());
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieMap.set(name, { name, value });
            responseCookies.push({ name, value, options });
          });
        },
      },
    },
  );

  // --- Exchange the OAuth code for a session (uses PKCE verifier from cookie) ---
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorPath = slug
      ? `/m/${slug}/login?error=${encodeURIComponent(error.message)}`
      : `/login?error=${encodeURIComponent(error.message)}`;
    return NextResponse.redirect(new URL(errorPath, base));
  }

  // --- Post-auth: profile upsert + membership logic ---
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const fullName =
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split("@")[0] ??
      "";

    await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      email: user.email ?? null,
    });

    // Mosque-scoped OAuth: check membership, redirect to complete-signup if new
    if (slug) {
      const { data: mosque } = await supabase
        .from("mosques")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (mosque) {
        const { data: existing } = await supabase
          .from("mosque_memberships")
          .select("id")
          .eq("profile_id", user.id)
          .eq("mosque_id", mosque.id)
          .maybeSingle();

        if (!existing) {
          // No membership yet — redirect to complete-signup so user can pick a role.
          // The `next` param from the redirect URL already points to complete-signup
          // for the new flow. For backwards compatibility, if `next` still points to
          // dashboard (e.g. from login page OAuth), override it.
          const completePath = `/m/${slug}/complete-signup`;
          const res = NextResponse.redirect(new URL(completePath, base));
          responseCookies.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options),
          );
          return res;
        }
      }
    }

    // Global signup: redirect new users to create a masjid
    if (!slug) {
      const { data: memberships } = await supabase
        .from("mosque_memberships")
        .select("id")
        .eq("profile_id", user.id)
        .limit(1);

      if (!memberships || memberships.length === 0) {
        const res = NextResponse.redirect(new URL("/create-masjid", base));
        responseCookies.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options),
        );
        return res;
      }
    }
  }

  // --- Redirect to the final destination with session cookies ---
  const response = NextResponse.redirect(new URL(next, base));
  responseCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );
  return response;
}
