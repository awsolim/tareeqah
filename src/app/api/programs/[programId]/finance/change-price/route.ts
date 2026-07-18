import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";
import { getCheckoutOrigin, getPortalReturnPath } from "@/lib/stripe/checkout-url";
import { cancelProgramSubscription } from "@/lib/stripe/subscriptions";
import { requireProgramFinanceAccess } from "@/lib/finance/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ChangePriceRequestBody = {
  studentProfileId?: string;
  amountCents?: number;
  billingMode?: "monthly" | "one_time";
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

    const body = (await request.json()) as ChangePriceRequestBody;
    if (!body.studentProfileId) {
      return Response.json({ error: "Missing student." }, { status: 400 });
    }
    const billingMode = body.billingMode === "one_time" ? "one_time" : "monthly";
    const amountCents = Math.round(body.amountCents ?? 0);
    if (!amountCents || amountCents < 50) {
      return Response.json({ error: "Enter a valid price." }, { status: 400 });
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

    const { data: program, error: programError } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
    if (programError || !program) {
      return Response.json({ error: programError?.message ?? "Class not found." }, { status: 404 });
    }
    if (!program.stripe_product_id) {
      return Response.json({ error: "Stripe is not configured for this class yet." }, { status: 409 });
    }
    if (program.is_ongoing && billingMode === "one_time") {
      return Response.json({ error: "Ongoing programs can't use Pay in Full — choose Monthly instead." }, { status: 409 });
    }

    const { data: mosque, error: mosqueError } = await supabase.from("mosques").select("*").eq("id", program.mosque_id).maybeSingle();
    if (mosqueError || !mosque) {
      return Response.json({ error: mosqueError?.message ?? "Masjid not found." }, { status: 404 });
    }

    const { data: existingSubscription } = await supabase
      .from("program_subscriptions")
      .select("*")
      .eq("program_id", programId)
      .eq("student_profile_id", body.studentProfileId)
      .maybeSingle();

    await cancelProgramSubscription(supabase, existingSubscription);

    const [{ data: link }, { data: student }] = await Promise.all([
      supabase
        .from("parent_child_links")
        .select("parent_profile_id")
        .eq("mosque_id", program.mosque_id)
        .eq("child_profile_id", body.studentProfileId)
        .maybeSingle(),
      supabase.from("profiles").select("full_name, email").eq("id", body.studentProfileId).maybeSingle(),
    ]);
    const parentProfileId = link?.parent_profile_id ?? existingSubscription?.parent_profile_id ?? null;
    const { data: parent } = parentProfileId
      ? await supabase.from("profiles").select("full_name, email").eq("id", parentProfileId).maybeSingle()
      : { data: null };

    const stripeRequestOptions = shouldUseStripeConnect() && mosque.stripe_account_id ? { stripeAccount: mosque.stripe_account_id } : undefined;
    const stripe = getStripe();

    const dynamicPrice = await stripe.prices.create(
      {
        product: program.stripe_product_id,
        currency: "cad",
        unit_amount: amountCents,
        ...(billingMode === "monthly" ? { recurring: { interval: "month" as const } } : {}),
        metadata: {
          program_id: programId,
          mosque_id: program.mosque_id,
          student_profile_id: body.studentProfileId,
          payment_type: billingMode === "monthly" ? "monthly" : "annual",
          changed_by_profile_id: user.id,
        },
      },
      stripeRequestOptions,
    );

    const origin = getCheckoutOrigin(request);
    const returnPath = getPortalReturnPath(origin, mosque.slug);
    const checkoutMetadata = {
      program_id: programId,
      mosque_id: program.mosque_id,
      student_profile_id: body.studentProfileId,
      parent_profile_id: parentProfileId ?? "",
      stripe_account_id: mosque.stripe_account_id,
      payment_type: billingMode === "monthly" ? "monthly" : "annual",
      stripe_price_id: dynamicPrice.id,
    };

    const session = await stripe.checkout.sessions.create(
      {
        mode: billingMode === "monthly" ? "subscription" : "payment",
        line_items: [{ price: dynamicPrice.id, quantity: 1 }],
        customer_email: parent?.email ?? student?.email ?? undefined,
        success_url: `${origin}${returnPath}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${returnPath}?payment=cancelled`,
        ...(billingMode === "monthly" ? { subscription_data: { metadata: checkoutMetadata } } : {}),
        metadata: checkoutMetadata,
      },
      stripeRequestOptions,
    );

    await supabase.from("program_subscriptions").upsert(
      {
        mosque_id: program.mosque_id,
        program_id: programId,
        student_profile_id: body.studentProfileId,
        parent_profile_id: parentProfileId,
        stripe_account_id: mosque.stripe_account_id,
        stripe_checkout_session_id: session.id,
        stripe_price_id: dynamicPrice.id,
        payment_type: billingMode === "monthly" ? "monthly" : "annual",
        status: "checkout_started",
        payment_paused: false,
        payment_paused_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "program_id,student_profile_id" },
    );

    const note = body.note?.trim() || null;
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: body.studentProfileId,
      actorProfileId: user.id,
      eventType: "price_changed",
      summary: `New checkout link sent to ${student?.full_name || student?.email || "this student"} for ${(amountCents / 100).toFixed(2)} CAD (${billingMode === "monthly" ? "monthly" : "one-time"}).${note ? ` Note: ${note}` : ""}`,
      metadata: { amountCents, billingMode, stripePriceId: dynamicPrice.id, checkoutSessionId: session.id, note },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change price.";
    return Response.json({ error: message }, { status: 500 });
  }
}
