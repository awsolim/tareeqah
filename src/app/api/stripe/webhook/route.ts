import Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe/server";
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

function shouldUseStripeConnect() {
  return process.env.STRIPE_CONNECT_PLATFORM === "true";
}

async function upsertPaidEnrollmentFromSession(session: Stripe.Checkout.Session, stripeAccountId: string | undefined) {
  const metadata = session.metadata ?? {};
  const enrollmentRequestId = metadata.enrollment_request_id;
  const mosqueId = metadata.mosque_id;
  const programId = metadata.program_id;
  const studentProfileId = metadata.student_profile_id;
  const parentProfileId = metadata.parent_profile_id || null;

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

  await supabase.from("program_subscriptions").upsert(
    {
      mosque_id: mosqueId,
      program_id: programId,
      student_profile_id: studentProfileId,
      parent_profile_id: parentProfileId,
      program_track_id: enrollmentRequest?.program_track_id ?? null,
      enrollment_request_id: enrollmentRequestId,
      stripe_account_id: stripeAccountId ?? metadata.stripe_account_id ?? null,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripe_subscription_id: subscriptionId,
      stripe_checkout_session_id: session.id,
      stripe_price_id: subscription?.items.data[0]?.price.id ?? null,
      status: subscription?.status ?? "active",
      current_period_start: period.start,
      current_period_end: period.end,
      cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id,student_profile_id" },
  );

  await supabase.from("enrollments").upsert(
    {
      program_id: programId,
      student_profile_id: studentProfileId,
      program_track_id: enrollmentRequest?.program_track_id ?? null,
    },
    { onConflict: "program_id,student_profile_id" },
  );

  await supabase.from("enrollment_requests").update({ student_dismissed_at: new Date().toISOString() }).eq("id", enrollmentRequestId);
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
      stripe_account_id: stripeAccountId ?? metadata.stripe_account_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe webhook handling failed.";
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({ received: true });
}
