import { requireProgramManageAccess } from "@/lib/programs/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type WaiveRequestBody = {
  note?: string | null;
  external?: boolean;
};

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

    const access = await requireProgramManageAccess(supabase, programId, user.id);
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json().catch(() => ({}))) as WaiveRequestBody;

    const { data: enrollmentRequest, error: requestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", requestId)
      .eq("program_id", programId)
      .maybeSingle();
    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "Application not found." }, { status: 404 });
    }
    if (enrollmentRequest.status !== "approved" || enrollmentRequest.admission_completed_at) {
      return Response.json({ error: "This application is not in an approved-awaiting-confirmation state." }, { status: 409 });
    }

    const note = body.note?.trim() || null;
    const external = Boolean(body.external);
    const { error: updateError } = await supabase
      .from("enrollment_requests")
      .update({
        payment_bypassed: true,
        payment_bypass_external: external,
        approved_price_monthly_cents: 0,
        approved_price_annual_cents: 0,
        decision_note: note ?? enrollmentRequest.decision_note,
      })
      .eq("id", requestId);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    const label = student?.full_name || student?.email || "this student";
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "application_payment_waived",
      summary: external
        ? `Payment marked as paid externally for ${label}. Registration confirmation is still required.`
        : `Payment waived for ${label}. Registration confirmation is still required.`,
      metadata: { external },
    });

    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", programId).maybeSingle();
    const { data: mosque } = program ? await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle() : { data: null };
    if (program && mosque) {
      void sendPushNotification(supabase, {
        recipientProfileIds: [enrollmentRequest.parent_profile_id, enrollmentRequest.student_profile_id],
        title: "Payment waived",
        body: `Payment for ${program.title} was waived. Complete registration to activate the class.`,
        url: `/m/${mosque.slug}/registration/${requestId}`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not waive payment.";
    return Response.json({ error: message }, { status: 500 });
  }
}
