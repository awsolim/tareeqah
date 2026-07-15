import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ConfirmCheckoutBody = {
  checkoutSessionId?: string;
};

async function selectedTrackIdsForRequest(supabase: ReturnType<typeof createSupabaseServiceClient>, enrollmentRequestId: string, fallbackTrackId: string | null) {
  const { data } = await supabase.from("enrollment_request_tracks").select("program_track_id").eq("enrollment_request_id", enrollmentRequestId);
  const trackIds = (data ?? []).map((row) => row.program_track_id).filter((trackId): trackId is string => Boolean(trackId));
  return trackIds.length ? trackIds : fallbackTrackId ? [fallbackTrackId] : [];
}

async function replaceEnrollmentTracks(supabase: ReturnType<typeof createSupabaseServiceClient>, enrollmentId: string, trackIds: string[]) {
  await supabase.from("enrollment_tracks").delete().eq("enrollment_id", enrollmentId);
  if (trackIds.length) {
    await supabase.from("enrollment_tracks").insert(trackIds.map((trackId) => ({ enrollment_id: enrollmentId, program_track_id: trackId })));
  }
}

async function replaceSubscriptionTracks(supabase: ReturnType<typeof createSupabaseServiceClient>, subscriptionRowId: string, trackIds: string[]) {
  await supabase.from("program_subscription_tracks").delete().eq("program_subscription_id", subscriptionRowId);
  if (trackIds.length) {
    await supabase.from("program_subscription_tracks").insert(trackIds.map((trackId) => ({ program_subscription_id: subscriptionRowId, program_track_id: trackId })));
  }
}

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

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as ConfirmCheckoutBody;
    if (!body.checkoutSessionId) {
      return Response.json({ error: "Missing checkout session." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const session = await getStripe().checkout.sessions.retrieve(body.checkoutSessionId, {
      expand: ["subscription"],
    });

    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return Response.json({ error: "Payment has not completed yet." }, { status: 409 });
    }

    const metadata = session.metadata ?? {};
    const enrollmentRequestId = metadata.enrollment_request_id;
    const mosqueId = metadata.mosque_id;
    const programId = metadata.program_id;
    const studentProfileId = metadata.student_profile_id;
    const parentProfileId = metadata.parent_profile_id || null;

    if (!enrollmentRequestId || !mosqueId || !programId || !studentProfileId) {
      return Response.json({ error: "Checkout session is missing enrollment details." }, { status: 400 });
    }

    const { data: enrollmentRequest, error: enrollmentRequestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", enrollmentRequestId)
      .maybeSingle();

    if (enrollmentRequestError || !enrollmentRequest) {
      return Response.json({ error: enrollmentRequestError?.message ?? "Enrollment request not found." }, { status: 404 });
    }

    const ownsRequest = enrollmentRequest.student_profile_id === user.id || enrollmentRequest.parent_profile_id === user.id;
    if (!ownsRequest) {
      return Response.json({ error: "You cannot confirm this payment." }, { status: 403 });
    }

    const subscription = typeof session.subscription === "string" ? null : session.subscription;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    const period = getSubscriptionPeriod(subscription);
    const now = new Date().toISOString();
    const trackIds = await selectedTrackIdsForRequest(supabase, enrollmentRequest.id, enrollmentRequest.program_track_id);

    const { data: subscriptionRow } = await supabase.from("program_subscriptions").upsert(
      {
        mosque_id: mosqueId,
        program_id: programId,
        student_profile_id: studentProfileId,
        parent_profile_id: parentProfileId,
        program_track_id: trackIds[0] ?? enrollmentRequest.program_track_id,
        enrollment_request_id: enrollmentRequestId,
        stripe_account_id: metadata.stripe_account_id ?? null,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        stripe_subscription_id: subscriptionId,
        stripe_checkout_session_id: session.id,
        stripe_price_id: subscription?.items.data[0]?.price.id ?? null,
        status: subscription?.status ?? "active",
        current_period_start: period.start,
        current_period_end: period.end,
        cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
        updated_at: now,
      },
      { onConflict: "program_id,student_profile_id" },
    ).select("id").single();

    const { data: enrollment } = await supabase.from("enrollments").upsert(
      {
        program_id: programId,
        student_profile_id: studentProfileId,
        program_track_id: trackIds[0] ?? enrollmentRequest.program_track_id,
      },
      { onConflict: "program_id,student_profile_id" },
    ).select("id").single();

    if (subscriptionRow) {
      await replaceSubscriptionTracks(supabase, subscriptionRow.id, trackIds);
    }
    if (enrollment) {
      await replaceEnrollmentTracks(supabase, enrollment.id, trackIds);
    }

    await supabase
      .from("enrollment_requests")
      .update({ admission_completed_at: now, student_dismissed_at: now, teacher_dismissed_at: null })
      .eq("id", enrollmentRequestId);

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm payment.";
    return Response.json({ error: message }, { status: 500 });
  }
}
