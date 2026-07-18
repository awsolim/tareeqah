import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";
import { cancelProgramSubscription, isActiveStripeSubscriptionStatus } from "@/lib/stripe/subscriptions";
import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type WaiveRequestBody = {
  studentProfileId?: string;
  timing?: "period_end" | "immediate";
  reason?: string;
  note?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as WaiveRequestBody;
    if (!body.studentProfileId) {
      return Response.json({ error: "Missing student." }, { status: 400 });
    }
    const timing = body.timing === "immediate" ? "immediate" : "period_end";
    const reason = body.reason?.trim() ?? "";
    if (!reason) {
      return Response.json({ error: "A reason is required to waive future payments." }, { status: 400 });
    }
    const note = body.note?.trim() || null;

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

    const { data: program, error: programError } = await supabase.from("programs").select("id, mosque_id").eq("id", programId).maybeSingle();
    if (programError || !program) {
      return Response.json({ error: programError?.message ?? "Class not found." }, { status: 404 });
    }

    const { data: subscription } = await supabase
      .from("program_subscriptions")
      .select("*")
      .eq("program_id", programId)
      .eq("student_profile_id", body.studentProfileId)
      .maybeSingle();

    const hasActiveSubscription = Boolean(subscription?.stripe_subscription_id && isActiveStripeSubscriptionStatus(subscription.status));
    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", body.studentProfileId).maybeSingle();
    const studentLabel = student?.full_name || student?.email || "this student";
    const now = new Date().toISOString();

    if (hasActiveSubscription && subscription) {
      if (timing === "immediate") {
        await cancelProgramSubscription(supabase, subscription);
      } else {
        const stripeOptions = shouldUseStripeConnect() && subscription.stripe_account_id ? { stripeAccount: subscription.stripe_account_id } : undefined;
        await getStripe().subscriptions.update(subscription.stripe_subscription_id!, { cancel_at_period_end: true }, stripeOptions);
        await supabase.from("program_subscriptions").update({ cancel_at_period_end: true, updated_at: now }).eq("id", subscription.id);
      }
    }

    const { data: link } = await supabase
      .from("parent_child_links")
      .select("parent_profile_id")
      .eq("mosque_id", program.mosque_id)
      .eq("child_profile_id", body.studentProfileId)
      .maybeSingle();
    const parentProfileId = link?.parent_profile_id ?? subscription?.parent_profile_id ?? null;

    await supabase.from("program_subscriptions").upsert(
      {
        mosque_id: program.mosque_id,
        program_id: programId,
        student_profile_id: body.studentProfileId,
        parent_profile_id: parentProfileId,
        payment_waived: true,
        payment_waived_reason: reason,
        payment_waived_at: now,
        updated_at: now,
      },
      { onConflict: "program_id,student_profile_id" },
    );

    const summary = hasActiveSubscription
      ? `Future payments waived for ${studentLabel}. Subscription ${timing === "immediate" ? "ended immediately" : "will end at the current period's close"}. Reason: ${reason}`
      : `Future payments waived for ${studentLabel}. Reason: ${reason}`;
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: body.studentProfileId,
      actorProfileId: user.id,
      eventType: "tuition_waived",
      summary: note ? `${summary} Note: ${note}` : summary,
      metadata: { timing, reason, note, hadActiveSubscription: hasActiveSubscription },
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not waive tuition.";
    return Response.json({ error: message }, { status: 500 });
  }
}
