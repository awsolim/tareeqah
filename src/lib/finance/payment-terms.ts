import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";

type SupaClient = SupabaseClient<Database>;
type EnrollmentRequestRow = Database["public"]["Tables"]["enrollment_requests"]["Row"];
type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
export type ProgramPaymentTermsRow = Database["public"]["Tables"]["program_payment_terms"]["Row"];

type ApprovedPaymentInput = {
  enrollmentRequest: EnrollmentRequestRow;
  program: ProgramRow;
  actorProfileId: string | null;
  paymentType?: "monthly" | "annual";
  priceMonthlyCents?: number | null;
  priceAnnualCents?: number | null;
  paymentBypassed?: boolean;
  paymentBypassedExternal?: boolean;
  note?: string | null;
};

function approvedPriceFor(input: ApprovedPaymentInput, paymentType: "monthly" | "annual") {
  if (input.paymentBypassed) {
    return 0;
  }
  if (paymentType === "annual") {
    return input.priceAnnualCents ?? input.enrollmentRequest.approved_price_annual_cents ?? input.program.price_annual_cents ?? null;
  }
  return input.priceMonthlyCents ?? input.enrollmentRequest.approved_price_monthly_cents ?? input.program.price_monthly_cents ?? null;
}

function paymentTypeFor(input: ApprovedPaymentInput): "free" | "waived" | "monthly" | "pay_in_full" {
  if (!input.program.is_paid) {
    return "free";
  }
  if (input.paymentBypassed) {
    return "waived";
  }
  return (input.paymentType ?? input.enrollmentRequest.payment_type) === "annual" ? "pay_in_full" : "monthly";
}

function billingEndBehaviorFor(program: ProgramRow, paymentType: string) {
  if (paymentType !== "monthly") {
    return "not_applicable";
  }
  return program.billing_end_behavior === "fixed_months" ? "fixed_month_count" : "ongoing_until_cancelled";
}

function billingMonthsFor(program: ProgramRow, paymentType: string) {
  if (paymentType !== "monthly" || program.billing_end_behavior !== "fixed_months") {
    return null;
  }
  return program.billing_duration_months ?? program.duration_months ?? null;
}

function statusFor(paymentType: string) {
  if (paymentType === "monthly" || paymentType === "pay_in_full") {
    return "payment_required";
  }
  return "pending_confirmation";
}

export async function createApprovedPaymentTerms(supabase: SupaClient, input: ApprovedPaymentInput) {
  const paymentType = paymentTypeFor(input);
  const legacyPaymentType: "monthly" | "annual" = paymentType === "pay_in_full" ? "annual" : "monthly";
  const amountCents =
    paymentType === "monthly" ? approvedPriceFor(input, "monthly") : paymentType === "pay_in_full" ? approvedPriceFor(input, "annual") : 0;
  const now = new Date().toISOString();

  await supabase
    .from("program_payment_terms")
    .update({ status: "superseded", updated_at: now })
    .eq("enrollment_request_id", input.enrollmentRequest.id)
    .not("status", "in", "(superseded,cancelled,ended)");

  const { data: terms, error } = await supabase
    .from("program_payment_terms")
    .insert({
      mosque_id: input.enrollmentRequest.mosque_id,
      program_id: input.enrollmentRequest.program_id,
      enrollment_request_id: input.enrollmentRequest.id,
      student_profile_id: input.enrollmentRequest.student_profile_id,
      parent_profile_id: input.enrollmentRequest.parent_profile_id,
      payment_type: paymentType,
      amount_cents: amountCents,
      currency: "cad",
      billing_months: billingMonthsFor(input.program, paymentType),
      billing_start_behavior: paymentType === "monthly" ? input.program.billing_start_behavior ?? "on_payment" : "not_applicable",
      billing_end_behavior: billingEndBehaviorFor(input.program, paymentType),
      program_start_date_snapshot: input.program.start_date ?? null,
      program_end_date_snapshot: input.program.end_date ?? null,
      status: statusFor(paymentType),
      approved_by: input.actorProfileId,
      approved_at: now,
      internal_note: input.note ?? null,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error || !terms) {
    throw new Error(error?.message ?? "Could not create approved payment terms.");
  }

  await supabase
    .from("enrollment_requests")
    .update({
      payment_terms_id: terms.id,
      payment_type: legacyPaymentType,
      approved_price_monthly_cents: paymentType === "waived" ? 0 : paymentType === "monthly" ? amountCents : null,
      approved_price_annual_cents: paymentType === "waived" ? 0 : paymentType === "pay_in_full" ? amountCents : null,
      payment_bypassed: paymentType === "free" || paymentType === "waived",
      payment_bypass_external: Boolean(input.paymentBypassedExternal),
    })
    .eq("id", input.enrollmentRequest.id);

  await recordFinanceAuditEvent(supabase, {
    programId: input.enrollmentRequest.program_id,
    studentProfileId: input.enrollmentRequest.student_profile_id,
    actorProfileId: input.actorProfileId,
    eventType: "payment_terms_created",
    summary: "Approved payment terms were created for this student.",
    metadata: {
      paymentTermsId: terms.id,
      paymentType,
      amountCents: amountCents ?? null,
      billingMonths: terms.billing_months,
      billingEndBehavior: terms.billing_end_behavior,
    },
  });

  return terms;
}

export async function getCurrentPaymentTermsForRequest(
  supabase: SupaClient,
  enrollmentRequestId: string,
): Promise<ProgramPaymentTermsRow | null> {
  const { data: enrollmentRequest } = await supabase
    .from("enrollment_requests")
    .select("payment_terms_id")
    .eq("id", enrollmentRequestId)
    .maybeSingle();

  if (enrollmentRequest?.payment_terms_id) {
    const { data: terms } = await supabase.from("program_payment_terms").select("*").eq("id", enrollmentRequest.payment_terms_id).maybeSingle();
    if (terms && !["superseded", "cancelled", "ended"].includes(terms.status)) {
      return terms;
    }
  }

  const { data: terms } = await supabase
    .from("program_payment_terms")
    .select("*")
    .eq("enrollment_request_id", enrollmentRequestId)
    .not("status", "in", "(superseded,cancelled,ended)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return terms ?? null;
}

export async function ensurePaymentTermsForRequest(supabase: SupaClient, enrollmentRequestId: string, actorProfileId: string | null) {
  const currentTerms = await getCurrentPaymentTermsForRequest(supabase, enrollmentRequestId);
  if (currentTerms) {
    return currentTerms;
  }

  const { data: enrollmentRequest, error: requestError } = await supabase
    .from("enrollment_requests")
    .select("*")
    .eq("id", enrollmentRequestId)
    .maybeSingle();
  if (requestError || !enrollmentRequest) {
    throw new Error(requestError?.message ?? "Enrollment request not found.");
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("*")
    .eq("id", enrollmentRequest.program_id)
    .maybeSingle();
  if (programError || !program) {
    throw new Error(programError?.message ?? "Program not found.");
  }

  return createApprovedPaymentTerms(supabase, {
    enrollmentRequest,
    program,
    actorProfileId,
    paymentType: enrollmentRequest.payment_type === "annual" ? "annual" : "monthly",
    priceMonthlyCents: enrollmentRequest.approved_price_monthly_cents,
    priceAnnualCents: enrollmentRequest.approved_price_annual_cents,
    paymentBypassed: enrollmentRequest.payment_bypassed || !program.is_paid,
    paymentBypassedExternal: enrollmentRequest.payment_bypass_external,
    note: "Compatibility terms created from the approved application.",
  });
}

export async function markPaymentTermsCheckoutStarted(
  supabase: SupaClient,
  params: { paymentTermsId: string; stripeCheckoutSessionId: string; stripePriceId: string },
) {
  await supabase
    .from("program_payment_terms")
    .update({
      status: "checkout_pending",
      stripe_checkout_session_id: params.stripeCheckoutSessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.paymentTermsId);
}

export async function markPaymentTermsNoPaymentCompleted(
  supabase: SupaClient,
  params: { paymentTermsId: string; paymentType: string; enrollmentId?: string | null },
) {
  await supabase
    .from("program_payment_terms")
    .update({
      status: params.paymentType === "waived" ? "waived" : "active",
      enrollment_id: params.enrollmentId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.paymentTermsId);
}
