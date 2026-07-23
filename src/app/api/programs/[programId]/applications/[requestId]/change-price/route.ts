import { requireProgramManageAccess } from "@/lib/programs/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createApprovedPaymentTerms } from "@/lib/finance/payment-terms";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ChangePriceRequestBody = {
  paymentType?: "monthly" | "annual";
  priceMonthlyCents?: number | null;
  priceAnnualCents?: number | null;
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

    const body = (await request.json()) as ChangePriceRequestBody;

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
    if (enrollmentRequest.payment_bypassed) {
      return Response.json({ error: "This application is waived — remove the waiver before changing the price." }, { status: 409 });
    }

    const paymentType = body.paymentType ?? (enrollmentRequest.payment_type === "annual" ? "annual" : "monthly");
    const priceCents = paymentType === "annual" ? body.priceAnnualCents : body.priceMonthlyCents;
    if (!priceCents || priceCents < 50) {
      return Response.json({ error: "Enter a valid price." }, { status: 400 });
    }

    const note = body.note?.trim() || null;
    const { error: updateError } = await supabase
      .from("enrollment_requests")
      .update({
        payment_type: paymentType,
        approved_price_monthly_cents: paymentType === "monthly" ? priceCents : null,
        approved_price_annual_cents: paymentType === "annual" ? priceCents : null,
        decision_note: note ?? enrollmentRequest.decision_note,
      })
      .eq("id", requestId);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const { data: programForTerms, error: programForTermsError } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
    if (programForTermsError || !programForTerms) {
      return Response.json({ error: programForTermsError?.message ?? "Class not found." }, { status: 404 });
    }

    await createApprovedPaymentTerms(supabase, {
      enrollmentRequest,
      program: programForTerms,
      actorProfileId: user.id,
      paymentType,
      priceMonthlyCents: paymentType === "monthly" ? priceCents : null,
      priceAnnualCents: paymentType === "annual" ? priceCents : null,
      paymentBypassed: false,
      note,
    });

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "approved_price_changed",
      summary: `Approved price changed to $${(priceCents / 100).toFixed(2)} ${paymentType === "annual" ? "(Pay in Full)" : "/month"} for ${student?.full_name || student?.email || "this student"}.`,
      metadata: { paymentType, priceCents },
    });

    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", programId).maybeSingle();
    const { data: mosque } = program ? await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle() : { data: null };
    if (program && mosque) {
      void sendPushNotification(supabase, {
        recipientProfileIds: [enrollmentRequest.parent_profile_id, enrollmentRequest.student_profile_id],
        title: "Price updated",
        body: `The approved price for ${program.title} was updated to $${(priceCents / 100).toFixed(2)}.`,
        url: `/m/${mosque.slug}/registration/${requestId}`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change price.";
    return Response.json({ error: message }, { status: 500 });
  }
}
