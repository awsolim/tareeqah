import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";
import { cancelProgramSubscription, isActiveStripeSubscriptionStatus } from "@/lib/stripe/subscriptions";
import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type EndSubscriptionRequestBody = {
  studentProfileId?: string;
  timing?: "period_end" | "immediate";
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as EndSubscriptionRequestBody;
    if (!body.studentProfileId) {
      return Response.json({ error: "Missing student." }, { status: 400 });
    }
    const timing = body.timing === "immediate" ? "immediate" : "period_end";

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
      .select("*")
      .eq("program_id", programId)
      .eq("student_profile_id", body.studentProfileId)
      .maybeSingle();

    if (!subscription?.stripe_subscription_id || !isActiveStripeSubscriptionStatus(subscription.status)) {
      return Response.json({ error: "This student doesn't have an active recurring subscription to end." }, { status: 409 });
    }

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", body.studentProfileId).maybeSingle();
    const studentLabel = student?.full_name || student?.email || "this student";

    if (timing === "immediate") {
      await cancelProgramSubscription(supabase, subscription);
      await recordFinanceAuditEvent(supabase, {
        programId,
        studentProfileId: body.studentProfileId,
        actorProfileId: user.id,
        eventType: "subscription_ended",
        summary: `Subscription ended immediately for ${studentLabel}. Future billing stopped right away.`,
        metadata: { timing },
      });
      return Response.json({ ok: true });
    }

    const stripeOptions = shouldUseStripeConnect() && subscription.stripe_account_id ? { stripeAccount: subscription.stripe_account_id } : undefined;
    await getStripe().subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true }, stripeOptions);
    await supabase
      .from("program_subscriptions")
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq("id", subscription.id);

    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: body.studentProfileId,
      actorProfileId: user.id,
      eventType: "subscription_ended",
      summary: `Subscription set to end at the current period's close for ${studentLabel}. No further charges after that date.`,
      metadata: { timing },
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not end subscription.";
    return Response.json({ error: message }, { status: 500 });
  }
}
