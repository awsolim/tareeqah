import { sendEnrollmentReviewedEmail } from "@/lib/email/enrollment";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ReviewedEmailRequestBody = {
  requestId?: string;
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

    const body = (await request.json()) as ReviewedEmailRequestBody;
    if (!body.requestId) {
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

    const result = await sendEnrollmentReviewedEmail(body.requestId, user.id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send enrollment email.";
    return Response.json({ error: message }, { status: 500 });
  }
}
