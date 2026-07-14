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

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
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

    const { data: allowed, error: allowedError } = await supabase.rpc("can_manage_program", {
      check_program_id: programId,
      check_profile_id: user.id,
    });

    if (allowedError || !allowed) {
      return Response.json({ error: "Director access required." }, { status: 403 });
    }

    const extension = extensionFromFile(file);
    const path = `program-media/${programId}/${crypto.randomUUID()}.${extension}`;
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
