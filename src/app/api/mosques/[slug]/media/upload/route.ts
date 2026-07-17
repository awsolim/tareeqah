import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function extensionFromFile(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const kindValue = formData.get("kind");
    const kind = kindValue === "logo" ? "logo" : "picture";
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing media file." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return Response.json({ error: "Only image uploads are supported here." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: mosque, error: mosqueError } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (mosqueError || !mosque) {
      return Response.json({ error: mosqueError?.message ?? "Masjid not found." }, { status: 404 });
    }

    const { data: adminMembership, error: membershipError } = await supabase
      .from("mosque_memberships")
      .select("id")
      .eq("mosque_id", mosque.id)
      .eq("profile_id", user.id)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !adminMembership) {
      return Response.json({ error: "Admin access required." }, { status: 403 });
    }

    const extension = extensionFromFile(file);
    const path = `mosque-media/${mosque.id}/${kind}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("media").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

    if (uploadError) {
      return Response.json({ error: uploadError.message }, { status: 500 });
    }

    const { data } = supabase.storage.from("media").getPublicUrl(path);
    return Response.json({ path, url: data.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload media.";
    return Response.json({ error: message }, { status: 500 });
  }
}
