import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type UnsubscribeRequestBody = {
  endpoint?: string;
};

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as UnsubscribeRequestBody;
    if (!body.endpoint) {
      return Response.json({ error: "Missing subscription endpoint." }, { status: 400 });
    }

    const { error: deleteError } = await supabase.from("push_subscriptions").delete().eq("profile_id", user.id).eq("endpoint", body.endpoint);
    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove push subscription.";
    return Response.json({ error: message }, { status: 500 });
  }
}
