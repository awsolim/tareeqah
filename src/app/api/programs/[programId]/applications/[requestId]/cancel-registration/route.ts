import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type CancelRegistrationRequestBody = {
  reason?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string; requestId: string }> }) {
  try {
    const { programId, requestId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as CancelRegistrationRequestBody;
    const reason = body.reason?.trim() ?? "";
    if (!reason) {
      return Response.json({ error: "A reason is required to cancel this registration." }, { status: 400 });
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
      .eq("id", requestId)
      .eq("program_id", programId)
      .maybeSingle();
    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "This registration could not be found." }, { status: 404 });
    }

    const ownsRequest = enrollmentRequest.student_profile_id === user.id || enrollmentRequest.parent_profile_id === user.id;
    if (!ownsRequest) {
      return Response.json({ error: "You do not have access to this registration." }, { status: 403 });
    }

    if (enrollmentRequest.status !== "approved") {
      return Response.json({ error: "This application is no longer available to cancel." }, { status: 409 });
    }
    if (enrollmentRequest.admission_completed_at) {
      return Response.json({ error: "This registration has already been completed and can no longer be cancelled here." }, { status: 409 });
    }

    const now = new Date().toISOString();
    await supabase
      .from("enrollment_requests")
      .update({
        status: "cancelled",
        decision_note: `Cancelled by family: ${reason}`,
        student_dismissed_at: now,
      })
      .eq("id", requestId);

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "registration_cancelled_by_family",
      summary: `Registration cancelled by family for ${student?.full_name || student?.email || "this student"}. Reason: ${reason}`,
      metadata: { reason },
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel registration.";
    return Response.json({ error: message }, { status: 500 });
  }
}
