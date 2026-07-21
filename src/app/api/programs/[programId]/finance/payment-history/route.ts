import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type PaymentHistoryRequestBody = {
  studentProfileId?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as PaymentHistoryRequestBody;
    if (!body.studentProfileId) {
      return Response.json({ error: "Missing student." }, { status: 400 });
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

    const { data: payments } = await supabase
      .from("program_payments")
      .select("id, amount_cents, currency, paid_at, receipt_url, tax_receipt_status, tax_receipt_eligible_amount_cents, tax_receipt_number")
      .eq("program_id", programId)
      .eq("student_profile_id", body.studentProfileId)
      .order("paid_at", { ascending: false })
      .limit(50);

    return Response.json({
      charges: (payments ?? []).map((payment) => ({
        id: payment.id,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        createdAt: payment.paid_at,
        receiptUrl: payment.receipt_url,
        taxReceiptStatus: payment.tax_receipt_status,
        taxReceiptEligibleAmountCents: payment.tax_receipt_eligible_amount_cents,
        taxReceiptNumber: payment.tax_receipt_number,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payment history.";
    return Response.json({ error: message }, { status: 500 });
  }
}
