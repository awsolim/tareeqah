import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logServerError } from "@/lib/monitoring/log-error";

const taxReceiptPolicyToInitialStatus: Record<string, string> = {
  not_applicable: "not_applicable",
  admin_review_required: "admin_review_required",
  eligible_confirmed: "eligible_pending_issue",
};

/**
 * Records a successful charge as a durable program_payments row, stamping the initial
 * tax_receipt_status from the program's declared tax_receipt_policy (never assumed
 * eligible by default). Idempotent via upsert + ignoreDuplicates on whichever Stripe id
 * is present, so a webhook retry never clobbers a tax-receipt status an admin already set.
 */
export async function insertProgramPayment(
  supabase: SupabaseClient<Database>,
  payment: {
    mosqueId: string;
    programId: string;
    programSubscriptionId?: string | null;
    studentProfileId?: string | null;
    parentProfileId?: string | null;
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeInvoiceId?: string | null;
    amountCents: number;
    currency: string;
    paidAt: string;
    receiptUrl?: string | null;
  },
) {
  if (!payment.amountCents || payment.amountCents <= 0) {
    return;
  }
  if (!payment.stripeChargeId && !payment.stripeInvoiceId) {
    return;
  }

  try {
    const { data: program } = await supabase
      .from("programs")
      .select("tax_receipt_policy")
      .eq("id", payment.programId)
      .maybeSingle();
    const taxReceiptStatus = taxReceiptPolicyToInitialStatus[program?.tax_receipt_policy ?? "not_applicable"] ?? "not_applicable";

    const row = {
      mosque_id: payment.mosqueId,
      program_id: payment.programId,
      program_subscription_id: payment.programSubscriptionId ?? null,
      student_profile_id: payment.studentProfileId ?? null,
      parent_profile_id: payment.parentProfileId ?? null,
      stripe_charge_id: payment.stripeChargeId ?? null,
      stripe_payment_intent_id: payment.stripePaymentIntentId ?? null,
      stripe_invoice_id: payment.stripeInvoiceId ?? null,
      amount_cents: payment.amountCents,
      currency: payment.currency,
      paid_at: payment.paidAt,
      receipt_url: payment.receiptUrl ?? null,
      tax_receipt_status: taxReceiptStatus,
    };

    const onConflict = payment.stripeChargeId ? "stripe_charge_id" : "stripe_invoice_id";
    const { error } = await supabase.from("program_payments").upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) {
      await logServerError(supabase, {
        source: "program_payments.insert",
        message: error.message,
        context: { programId: payment.programId, stripeChargeId: payment.stripeChargeId ?? null, stripeInvoiceId: payment.stripeInvoiceId ?? null },
      });
    }
  } catch (error) {
    await logServerError(supabase, {
      source: "program_payments.insert",
      message: error instanceof Error ? error.message : "Unknown error recording program payment.",
      context: { programId: payment.programId },
    });
  }
}
