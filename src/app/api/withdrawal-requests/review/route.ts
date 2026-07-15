import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ReviewWithdrawalBody = {
  withdrawalRequestId?: string;
  status?: "approved" | "rejected";
};

function shouldUseStripeConnect() {
  return process.env.STRIPE_CONNECT_PLATFORM === "true";
}

function isActiveStripeStatus(status: string | null | undefined) {
  return Boolean(status && !["canceled", "incomplete_expired"].includes(status));
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as ReviewWithdrawalBody;
    if (!body.withdrawalRequestId || !body.status) {
      return Response.json({ error: "Missing withdrawal review details." }, { status: 400 });
    }

    if (!["approved", "rejected"].includes(body.status)) {
      return Response.json({ error: "Invalid withdrawal decision." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: withdrawalRequest, error: requestError } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("id", body.withdrawalRequestId)
      .maybeSingle();

    if (requestError || !withdrawalRequest) {
      return Response.json({ error: requestError?.message ?? "Withdrawal request not found." }, { status: 404 });
    }

    if (withdrawalRequest.status !== "pending") {
      return Response.json({ error: "This withdrawal request has already been reviewed." }, { status: 409 });
    }

    const { data: canManage, error: manageError } = await supabase.rpc("can_manage_program", {
      check_program_id: withdrawalRequest.program_id,
      check_profile_id: user.id,
    });

    if (manageError || !canManage) {
      return Response.json({ error: manageError?.message ?? "You cannot review this withdrawal request." }, { status: 403 });
    }

    const now = new Date().toISOString();

    if (body.status === "rejected") {
      const { error: updateError } = await supabase
        .from("withdrawal_requests")
        .update({
          status: "rejected",
          reviewed_by: user.id,
          reviewed_at: now,
          decision_note: "Withdrawal rejected. Enrollment remains active.",
        })
        .eq("id", withdrawalRequest.id);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 });
      }

      return Response.json({ ok: true });
    }

    const { data: subscription } = await supabase
      .from("program_subscriptions")
      .select("*")
      .eq("program_id", withdrawalRequest.program_id)
      .eq("student_profile_id", withdrawalRequest.student_profile_id)
      .maybeSingle();

    if (subscription?.stripe_subscription_id && isActiveStripeStatus(subscription.status)) {
      const stripeOptions = shouldUseStripeConnect() && subscription.stripe_account_id ? { stripeAccount: subscription.stripe_account_id } : undefined;
      await getStripe().subscriptions.cancel(subscription.stripe_subscription_id, {}, stripeOptions);
      await supabase
        .from("program_subscriptions")
        .update({
          status: "canceled",
          cancel_at_period_end: false,
          updated_at: now,
        })
        .eq("id", subscription.id);
    }

    const { error: updateError } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: now,
        decision_note: "Withdrawal approved. Enrollment ended immediately.",
      })
      .eq("id", withdrawalRequest.id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const { error: enrollmentDeleteError } = await supabase
      .from("enrollments")
      .delete()
      .eq("program_id", withdrawalRequest.program_id)
      .eq("student_profile_id", withdrawalRequest.student_profile_id);

    if (enrollmentDeleteError) {
      return Response.json({ error: enrollmentDeleteError.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review withdrawal request.";
    return Response.json({ error: message }, { status: 500 });
  }
}
