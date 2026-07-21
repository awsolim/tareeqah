import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/types";

type ProgramPaymentUpdate = Database["public"]["Tables"]["program_payments"]["Update"];

export const runtime = "nodejs";

const allowedTaxReceiptStatuses = [
  "not_applicable",
  "admin_review_required",
  "eligible_pending_issue",
  "issued",
  "partial_issued",
  "not_eligible",
  "contact_admin",
];

type TaxReceiptRequestBody = {
  status?: string;
  eligibleAmountCents?: number | null;
  number?: string | null;
  note?: string | null;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ programId: string; paymentId: string }> }) {
  try {
    const { programId, paymentId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as TaxReceiptRequestBody;
    if (!body.status || !allowedTaxReceiptStatuses.includes(body.status)) {
      return Response.json({ error: "Invalid tax receipt status." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const access = await requireProgramFinanceAccess(supabase, programId, user.id);
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    const { data: payment } = await supabase
      .from("program_payments")
      .select("id, student_profile_id, tax_receipt_status")
      .eq("id", paymentId)
      .eq("program_id", programId)
      .maybeSingle();
    if (!payment) {
      return Response.json({ error: "Payment not found." }, { status: 404 });
    }

    const updates: ProgramPaymentUpdate = { tax_receipt_status: body.status };
    if (body.eligibleAmountCents !== undefined) {
      updates.tax_receipt_eligible_amount_cents = body.eligibleAmountCents;
    }
    if (body.number !== undefined) {
      updates.tax_receipt_number = body.number?.trim() || null;
    }
    if (body.note !== undefined) {
      updates.tax_receipt_note = body.note?.trim() || null;
    }
    if (body.status === "issued" || body.status === "partial_issued") {
      updates.tax_receipt_issued_at = new Date().toISOString();
      updates.tax_receipt_issued_by = user.id;
    }

    const { error } = await supabase.from("program_payments").update(updates).eq("id", paymentId);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: payment.student_profile_id,
      actorProfileId: user.id,
      eventType: "tax_receipt_status_changed",
      summary: `Tax receipt status changed from ${payment.tax_receipt_status} to ${body.status}.`,
      metadata: {
        paymentId,
        previousStatus: payment.tax_receipt_status,
        newStatus: body.status,
        eligibleAmountCents: body.eligibleAmountCents ?? null,
        number: body.number ?? null,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update tax receipt status.";
    return Response.json({ error: message }, { status: 500 });
  }
}
