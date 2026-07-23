import { requireProgramManageAccess } from "@/lib/programs/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createApprovedPaymentTerms } from "@/lib/finance/payment-terms";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ApproveRequestBody = {
  paymentType?: "monthly" | "annual";
  priceMonthlyCents?: number | null;
  priceAnnualCents?: number | null;
  paymentBypassed?: boolean;
  paymentBypassedExternal?: boolean;
  note?: string | null;
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

    const body = (await request.json()) as ApproveRequestBody;

    const { data: enrollmentRequest, error: requestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", requestId)
      .eq("program_id", programId)
      .maybeSingle();
    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "Application not found." }, { status: 404 });
    }
    if (!["pending", "waitlisted"].includes(enrollmentRequest.status)) {
      return Response.json({ error: "This application is no longer awaiting a decision." }, { status: 409 });
    }

    const { data: program, error: programError } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
    if (programError || !program) {
      return Response.json({ error: programError?.message ?? "Class not found." }, { status: 404 });
    }

    const paymentBypassed = Boolean(body.paymentBypassed);
    const paymentBypassedExternal = paymentBypassed && Boolean(body.paymentBypassedExternal);
    const approvalPaymentType = body.paymentType ?? (enrollmentRequest.payment_type === "annual" ? "annual" : "monthly");
    const approvalPrice = approvalPaymentType === "annual" ? body.priceAnnualCents : body.priceMonthlyCents;
    if (program.is_paid && !paymentBypassed && (approvalPrice ?? 0) < 50) {
      return Response.json(
        { error: `Paid approvals need a ${approvalPaymentType === "annual" ? "Pay in Full" : "monthly"} price of at least $0.50, or choose waived.` },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const note = body.note?.trim() || null;
    const { error: updateError } = await supabase
      .from("enrollment_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: now,
        review_note: note,
        decision_note: note,
        payment_type: approvalPaymentType,
        approved_price_monthly_cents: paymentBypassed ? 0 : approvalPaymentType === "monthly" ? body.priceMonthlyCents ?? program.price_monthly_cents ?? null : null,
        approved_price_annual_cents: paymentBypassed ? 0 : approvalPaymentType === "annual" ? body.priceAnnualCents ?? program.price_annual_cents ?? null : null,
        payment_bypassed: paymentBypassed,
        payment_bypass_external: paymentBypassedExternal,
        // Enrollment never activates on approval alone — only after the parent/student
        // completes Registration Confirmation (free/waived) or Stripe payment (paid).
        admission_completed_at: null,
        teacher_dismissed_at: null,
      })
      .eq("id", requestId);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    await createApprovedPaymentTerms(supabase, {
      enrollmentRequest,
      program,
      actorProfileId: user.id,
      paymentType: approvalPaymentType,
      priceMonthlyCents: paymentBypassed ? 0 : approvalPaymentType === "monthly" ? body.priceMonthlyCents ?? program.price_monthly_cents ?? null : null,
      priceAnnualCents: paymentBypassed ? 0 : approvalPaymentType === "annual" ? body.priceAnnualCents ?? program.price_annual_cents ?? null : null,
      paymentBypassed,
      paymentBypassedExternal,
      note,
    });

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    const label = student?.full_name || student?.email || "this student";
    const summary = paymentBypassed
      ? paymentBypassedExternal
        ? `Application approved for ${label} — payment marked as paid externally.`
        : `Application approved for ${label} — payment waived.`
      : program.is_paid
        ? `Application approved for ${label} at $${((approvalPrice ?? 0) / 100).toFixed(2)} ${approvalPaymentType === "annual" ? "(Pay in Full)" : "/month"}.`
        : `Application approved for ${label}.`;
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "application_approved",
      summary,
      metadata: { paymentType: approvalPaymentType, paymentBypassed, paymentBypassedExternal },
    });

    const { data: mosque } = await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle();
    if (mosque) {
      void sendPushNotification(supabase, {
        recipientProfileIds: [enrollmentRequest.parent_profile_id, enrollmentRequest.student_profile_id],
        title: "Application approved",
        body: `${label}'s application to ${program.title} was approved.`,
        url: `/m/${mosque.slug}/portal/classes?tab=applications`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not approve application.";
    return Response.json({ error: message }, { status: 500 });
  }
}
