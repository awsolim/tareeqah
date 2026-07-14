import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type CompleteAdmissionBody = {
  enrollmentRequestId?: string;
};

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as CompleteAdmissionBody;
    if (!body.enrollmentRequestId) {
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

    const { data: enrollmentRequest, error: requestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", body.enrollmentRequestId)
      .maybeSingle();

    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "Enrollment request not found." }, { status: 404 });
    }

    const ownsRequest = enrollmentRequest.student_profile_id === user.id || enrollmentRequest.parent_profile_id === user.id;
    if (!ownsRequest) {
      return Response.json({ error: "You cannot complete this admission." }, { status: 403 });
    }

    if (enrollmentRequest.status !== "approved" || !enrollmentRequest.payment_bypassed) {
      return Response.json({ error: "This admission is not approved for payment bypass." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { error: enrollmentError } = await supabase.from("enrollments").upsert(
      {
        program_id: enrollmentRequest.program_id,
        student_profile_id: enrollmentRequest.student_profile_id,
        program_track_id: enrollmentRequest.program_track_id,
      },
      { onConflict: "program_id,student_profile_id" },
    );

    if (enrollmentError) {
      return Response.json({ error: enrollmentError.message }, { status: 500 });
    }

    await supabase.from("enrollment_requests").update({ student_dismissed_at: now }).eq("id", enrollmentRequest.id);

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete admission.";
    return Response.json({ error: message }, { status: 500 });
  }
}
