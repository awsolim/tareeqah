import { activateEnrollmentForRequest } from "@/lib/programs/enrollment-activation";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { ensurePaymentTermsForRequest, markPaymentTermsNoPaymentCompleted } from "@/lib/finance/payment-terms";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ programId: string; requestId: string }> }) {
  try {
    const { programId, requestId } = await params;
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
      return Response.json({ error: "This application is no longer available for confirmation." }, { status: 409 });
    }
    if (enrollmentRequest.admission_completed_at) {
      return Response.json({ error: "This registration has already been completed." }, { status: 409 });
    }

    const { data: program, error: programError } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
    if (programError || !program) {
      return Response.json({ error: programError?.message ?? "This class is no longer available." }, { status: 404 });
    }
    if (program.is_paid && !enrollmentRequest.payment_bypassed) {
      return Response.json({ error: "Payment is required to complete this registration." }, { status: 409 });
    }

    const terms = await ensurePaymentTermsForRequest(supabase, requestId, user.id);
    if (terms.payment_type === "monthly" || terms.payment_type === "pay_in_full") {
      return Response.json({ error: "Payment is required to complete this registration." }, { status: 409 });
    }

    await activateEnrollmentForRequest(supabase, {
      enrollmentRequestId: requestId,
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      fallbackTrackId: enrollmentRequest.program_track_id,
    });

    await markPaymentTermsNoPaymentCompleted(supabase, {
      paymentTermsId: terms.id,
      paymentType: terms.payment_type,
    });

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "registration_confirmed_no_payment",
      summary: `${student?.full_name || student?.email || "This student"}'s registration was confirmed. No payment was required.`,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm registration.";
    return Response.json({ error: message }, { status: 500 });
  }
}
