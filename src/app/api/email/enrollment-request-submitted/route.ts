import { sendEnrollmentSubmittedEmails } from "@/lib/email/enrollment";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type SubmittedEmailRequestBody = {
  requestId?: string;
  requestIds?: string[];
};

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as SubmittedEmailRequestBody;
    const requestIds = Array.from(new Set([...(body.requestIds ?? []), body.requestId].filter((id): id is string => Boolean(id)))).slice(0, 20);
    if (requestIds.length === 0) {
      return Response.json({ error: "Missing enrollment request." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const result = await sendEnrollmentSubmittedEmails(requestIds, user.id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send enrollment email.";
    return Response.json({ error: message }, { status: 500 });
  }
}
