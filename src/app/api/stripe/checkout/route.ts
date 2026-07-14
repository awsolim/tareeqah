import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type CheckoutRequestBody = {
  enrollmentRequestId?: string;
};

function getOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    return requestOrigin.replace(/\/$/, "");
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return new URL(referer).origin;
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  return new URL(request.url).origin;
}

function shouldUseStripeConnect() {
  return process.env.STRIPE_CONNECT_PLATFORM === "true";
}

function isMasjidSubdomain(origin: string, mosqueSlug: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "tareeqah.ca").toLowerCase();

    return hostname === `${mosqueSlug}.${rootDomain}` || hostname === `${mosqueSlug}.localhost`;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as CheckoutRequestBody;
    if (!body.enrollmentRequestId) {
      return Response.json({ error: "Missing enrollment request." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: enrollmentRequest, error: requestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", body.enrollmentRequestId)
      .maybeSingle();

    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "Enrollment request not found." }, { status: 404 });
    }

    const ownsRequest = enrollmentRequest.student_profile_id === user.id || enrollmentRequest.parent_profile_id === user.id;
    if (!ownsRequest) {
      return Response.json({ error: "You cannot pay for this request." }, { status: 403 });
    }

    if (enrollmentRequest.status !== "approved") {
      return Response.json({ error: "This request has not been approved yet." }, { status: 409 });
    }

    const [{ data: program }, { data: mosque }, { data: profile }] = await Promise.all([
      supabase.from("programs").select("*").eq("id", enrollmentRequest.program_id).maybeSingle(),
      supabase.from("mosques").select("*").eq("id", enrollmentRequest.mosque_id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);

    if (!program || !mosque) {
      return Response.json({ error: "Class payment details could not be loaded." }, { status: 404 });
    }

    if (!program.is_paid) {
      return Response.json({ error: "This class is not paid." }, { status: 409 });
    }

    if (enrollmentRequest.payment_bypassed) {
      return Response.json({ error: "Payment is not required for this registration." }, { status: 409 });
    }

    const approvedAmount = enrollmentRequest.approved_price_monthly_cents ?? program.price_monthly_cents;
    if (!approvedAmount || approvedAmount < 50) {
      return Response.json({ error: "This approval does not have a valid monthly price." }, { status: 409 });
    }

    const stripeRequestOptions = shouldUseStripeConnect() && mosque.stripe_account_id ? { stripeAccount: mosque.stripe_account_id } : undefined;

    const origin = getOrigin(request);
    const returnPath = isMasjidSubdomain(origin, mosque.slug) ? "/portal/announcements" : `/m/${mosque.slug}/portal/announcements`;
    const stripe = getStripe();
    const productId = program.stripe_product_id;
    if (!productId) {
      return Response.json({ error: "Stripe is not configured for this class yet." }, { status: 409 });
    }

    const dynamicPrice = await stripe.prices.create(
      {
        product: productId,
        currency: "usd",
        unit_amount: approvedAmount,
        recurring: { interval: "month" },
        metadata: {
          enrollment_request_id: enrollmentRequest.id,
          mosque_id: enrollmentRequest.mosque_id,
          program_id: enrollmentRequest.program_id,
          student_profile_id: enrollmentRequest.student_profile_id,
        },
      },
      stripeRequestOptions,
    );

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: dynamicPrice.id, quantity: 1 }],
        customer_email: profile?.email ?? user.email ?? undefined,
        client_reference_id: enrollmentRequest.id,
        success_url: `${origin}${returnPath}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${returnPath}?payment=cancelled`,
        subscription_data: {
          metadata: {
            enrollment_request_id: enrollmentRequest.id,
            mosque_id: enrollmentRequest.mosque_id,
            program_id: enrollmentRequest.program_id,
            student_profile_id: enrollmentRequest.student_profile_id,
            parent_profile_id: enrollmentRequest.parent_profile_id ?? "",
            stripe_account_id: mosque.stripe_account_id,
          },
        },
        metadata: {
          enrollment_request_id: enrollmentRequest.id,
          mosque_id: enrollmentRequest.mosque_id,
          program_id: enrollmentRequest.program_id,
          student_profile_id: enrollmentRequest.student_profile_id,
          parent_profile_id: enrollmentRequest.parent_profile_id ?? "",
          stripe_account_id: mosque.stripe_account_id,
        },
      },
      stripeRequestOptions,
    );

    await supabase.from("program_subscriptions").upsert(
      {
        mosque_id: enrollmentRequest.mosque_id,
        program_id: enrollmentRequest.program_id,
        student_profile_id: enrollmentRequest.student_profile_id,
        parent_profile_id: enrollmentRequest.parent_profile_id,
        enrollment_request_id: enrollmentRequest.id,
        stripe_account_id: mosque.stripe_account_id,
        stripe_checkout_session_id: session.id,
        stripe_price_id: dynamicPrice.id,
        status: "checkout_started",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "program_id,student_profile_id" },
    );

    return Response.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    return Response.json({ error: message }, { status: 500 });
  }
}
