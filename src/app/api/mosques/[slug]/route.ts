import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type UpdateMosqueBody = {
  name?: string | null;
  slug?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  pictureUrl?: string | null;
};

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function cleanSlug(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || null;
}

async function getAuthenticatedUserId(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return { userId: null, error: "Not authenticated." };
  }

  const supabase = createSupabaseServiceClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { userId: null, error: "Not authenticated." };
  }

  return { userId: user.id, error: null };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const auth = await getAuthenticatedUserId(request);
    if (!auth.userId) {
      return Response.json({ error: auth.error }, { status: 401 });
    }

    const body = (await request.json()) as UpdateMosqueBody;
    const name = cleanText(body.name, 160);
    if (!name) {
      return Response.json({ error: "Masjid name is required." }, { status: 400 });
    }
    const nextSlug = cleanSlug(body.slug) ?? slug;

    const supabase = createSupabaseServiceClient();
    const { data: mosque, error: mosqueError } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (mosqueError || !mosque) {
      return Response.json({ error: mosqueError?.message ?? "Masjid not found." }, { status: 404 });
    }

    const { data: adminMembership, error: membershipError } = await supabase
      .from("mosque_memberships")
      .select("id")
      .eq("mosque_id", mosque.id)
      .eq("profile_id", auth.userId)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !adminMembership) {
      return Response.json({ error: "Admin access required." }, { status: 403 });
    }

    if (nextSlug !== slug) {
      const { data: existingSlug } = await supabase.from("mosques").select("id").eq("slug", nextSlug).neq("id", mosque.id).maybeSingle();
      if (existingSlug) {
        return Response.json({ error: "That masjid URL is already in use." }, { status: 409 });
      }
    }

    const { data: updatedMosque, error: updateError } = await supabase
      .from("mosques")
      .update({
        name,
        slug: nextSlug,
        address: cleanText(body.address, 240),
        logo_url: cleanText(body.logoUrl, 1000),
        picture_url: cleanText(body.pictureUrl, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", mosque.id)
      .select("*")
      .single();

    if (updateError || !updatedMosque) {
      return Response.json({ error: updateError?.message ?? "Could not update masjid." }, { status: 500 });
    }

    return Response.json({ mosque: updatedMosque });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update masjid.";
    return Response.json({ error: message }, { status: 500 });
  }
}
