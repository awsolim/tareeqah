import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";
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

    const { data: subscription } = await supabase
      .from("program_subscriptions")
      .select("stripe_customer_id, stripe_account_id")
      .eq("program_id", programId)
      .eq("student_profile_id", body.studentProfileId)
      .maybeSingle();

    if (!subscription?.stripe_customer_id) {
      return Response.json({ charges: [] });
    }

    const stripeOptions = shouldUseStripeConnect() && subscription.stripe_account_id ? { stripeAccount: subscription.stripe_account_id } : undefined;
    const charges = await getStripe().charges.list({ customer: subscription.stripe_customer_id, limit: 20 }, stripeOptions);

    return Response.json({
      charges: charges.data.map((charge) => ({
        id: charge.id,
        amountCents: charge.amount,
        currency: charge.currency,
        status: charge.status,
        refunded: charge.refunded,
        createdAt: new Date(charge.created * 1000).toISOString(),
        receiptUrl: charge.receipt_url,
        description: charge.description,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payment history.";
    return Response.json({ error: message }, { status: 500 });
  }
}
