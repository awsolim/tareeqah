import Stripe from "stripe";
import { getStripe, getStripeWebhookSecret, shouldUseStripeConnect } from "@/lib/stripe/server";
import { activateEnrollmentForRequest, selectedTrackIdsForRequest } from "@/lib/programs/enrollment-activation";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function stripeTimestampToIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function getSubscriptionPeriod(subscription: Stripe.Subscription | null) {
  const item = subscription?.items.data[0];
  return {
    start: stripeTimestampToIso(item?.current_period_start),
    end: stripeTimestampToIso(item?.current_period_end),
  };
}

async function replaceSubscriptionTracks(supabase: ReturnType<typeof createSupabaseServiceClient>, subscriptionRowId: string, trackIds: string[]) {
  await supabase.from("program_subscription_tracks").delete().eq("program_subscription_id", subscriptionRowId);
  if (trackIds.length) {
    await supabase.from("program_subscription_tracks").insert(trackIds.map((trackId) => ({ program_subscription_id: subscriptionRowId, program_track_id: trackId })));
  }
}

async function upsertPaidEnrollmentFromSession(session: Stripe.Checkout.Session, stripeAccountId: string | undefined) {
  const metadata = session.metadata ?? {};
  const enrollmentRequestId = metadata.enrollment_request_id;
  const mosqueId = metadata.mosque_id;
  const programId = metadata.program_id;
  const studentProfileId = metadata.student_profile_id;
  const parentProfileId = metadata.parent_profile_id || null;
  const paymentType = metadata.payment_type === "annual" ? "annual" : "monthly";

  if (!enrollmentRequestId || !mosqueId || !programId || !studentProfileId) {
    return;
  }

  const supabase = createSupabaseServiceClient();
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  let subscription: Stripe.Subscription | null = null;
  if (subscriptionId) {
    const stripeRequestOptions = shouldUseStripeConnect() && stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    subscription = await getStripe().subscriptions.retrieve(subscriptionId, undefined, stripeRequestOptions);
  }
  const period = getSubscriptionPeriod(subscription);

  const { data: enrollmentRequest } = await supabase
    .from("enrollment_requests")
    .select("program_track_id")
    .eq("id", enrollmentRequestId)
    .maybeSingle();
  const trackIds = await selectedTrackIdsForRequest(supabase, enrollmentRequestId, enrollmentRequest?.program_track_id ?? null);

  const { data: subscriptionRow } = await supabase.from("program_subscriptions").upsert(
    {
      mosque_id: mosqueId,
      program_id: programId,
      student_profile_id: studentProfileId,
      parent_profile_id: parentProfileId,
      program_track_id: trackIds[0] ?? enrollmentRequest?.program_track_id ?? null,
      enrollment_request_id: enrollmentRequestId,
      stripe_account_id: stripeAccountId ?? metadata.stripe_account_id ?? null,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripe_subscription_id: subscriptionId,
      stripe_checkout_session_id: session.id,
      stripe_price_id: subscription?.items.data[0]?.price.id ?? metadata.stripe_price_id ?? null,
      payment_type: paymentType,
      status: subscription?.status ?? (paymentType === "annual" ? "paid" : "active"),
      current_period_start: period.start,
      current_period_end: period.end,
      cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id,student_profile_id" },
  ).select("id").single();

  if (subscriptionRow) {
    await replaceSubscriptionTracks(supabase, subscriptionRow.id, trackIds);
  }

  await activateEnrollmentForRequest(supabase, {
    enrollmentRequestId,
    programId,
    studentProfileId,
    fallbackTrackId: enrollmentRequest?.program_track_id ?? null,
  });

  const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", studentProfileId).maybeSingle();
  await recordFinanceAuditEvent(supabase, {
    programId,
    studentProfileId,
    actorProfileId: null,
    eventType: paymentType === "annual" ? "payment_completed" : "subscription_started",
    summary:
      paymentType === "annual"
        ? `Payment completed and enrollment activated for ${student?.full_name || student?.email || "this student"}.`
        : `Subscription started and enrollment activated for ${student?.full_name || student?.email || "this student"}.`,
    metadata: { stripeSubscriptionId: subscriptionId, stripeCheckoutSessionId: session.id },
  });
}

async function updateSubscription(subscription: Stripe.Subscription, stripeAccountId: string | undefined) {
  const metadata = subscription.metadata ?? {};
  const supabase = createSupabaseServiceClient();
  const period = getSubscriptionPeriod(subscription);

  await supabase
    .from("program_subscriptions")
    .update({
      status: subscription.status,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripe_price_id: subscription.items.data[0]?.price.id ?? null,
      current_period_start: period.start,
      current_period_end: period.end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      payment_paused: Boolean(subscription.pause_collection),
      payment_paused_until: stripeTimestampToIso(subscription.pause_collection?.resumes_at),
      stripe_account_id: stripeAccountId ?? metadata.stripe_account_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionRef = invoice.parent?.subscription_details?.subscription ?? null;
  const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id ?? null;
  if (!subscriptionId) {
    return;
  }
  const supabase = createSupabaseServiceClient();
  const { data: subscriptionRow } = await supabase
    .from("program_subscriptions")
    .select("id, program_id, student_profile_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (!subscriptionRow?.program_id || !subscriptionRow.student_profile_id) {
    return;
  }

  await supabase
    .from("program_subscriptions")
    .update({
      current_period_start: stripeTimestampToIso(invoice.period_start),
      current_period_end: stripeTimestampToIso(invoice.period_end),
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionRow.id);

  const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", subscriptionRow.student_profile_id).maybeSingle();
  await recordFinanceAuditEvent(supabase, {
    programId: subscriptionRow.program_id,
    studentProfileId: subscriptionRow.student_profile_id,
    actorProfileId: null,
    eventType: "invoice_paid",
    summary: `Payment received for ${student?.full_name || student?.email || "this student"}.`,
    metadata: { stripeSubscriptionId: subscriptionId, amountPaidCents: invoice.amount_paid },
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionRef = invoice.parent?.subscription_details?.subscription ?? null;
  const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id ?? null;
  if (!subscriptionId) {
    return;
  }
  const supabase = createSupabaseServiceClient();
  const { data: subscriptionRow } = await supabase
    .from("program_subscriptions")
    .select("id, program_id, student_profile_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (!subscriptionRow?.program_id || !subscriptionRow.student_profile_id) {
    return;
  }

  const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", subscriptionRow.student_profile_id).maybeSingle();
  await recordFinanceAuditEvent(supabase, {
    programId: subscriptionRow.program_id,
    studentProfileId: subscriptionRow.student_profile_id,
    actorProfileId: null,
    eventType: "payment_failed",
    summary: `Payment failed for ${student?.full_name || student?.email || "this student"}. The student remains enrolled; billing will show as past due.`,
    metadata: { stripeSubscriptionId: subscriptionId },
  });
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, getStripeWebhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    return Response.json({ error: message }, { status: 400 });
  }

  const stripeAccountId = shouldUseStripeConnect() ? event.account ?? undefined : undefined;

  try {
    if (event.type === "checkout.session.completed") {
      await upsertPaidEnrollmentFromSession(event.data.object as Stripe.Checkout.Session, stripeAccountId);
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await updateSubscription(event.data.object as Stripe.Subscription, stripeAccountId);
    }

    if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
    }

    if (event.type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe webhook handling failed.";
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({ received: true });
}
