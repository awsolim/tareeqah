import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

type CreateProgramBody = {
  mosqueSlug?: string;
  title?: string;
  description?: string | null;
  isPaid?: boolean;
  offersMonthlyPayment?: boolean;
  offersAnnualPayment?: boolean;
  priceMonthlyCents?: number | null;
  priceAnnualCents?: number | null;
  thumbnailUrl?: string | null;
  audienceGender?: string | null;
  ageRangeText?: string | null;
  schedule?: Json | null;
  scheduleTimezone?: string | null;
  trackSelectionMode?: string;
  trackSelectionCount?: number;
  directorProfileId?: string | null;
};

function shouldUseStripeConnect() {
  return process.env.STRIPE_CONNECT_PLATFORM === "true";
}

function cleanTitle(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function cleanDescription(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2000) : null;
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as CreateProgramBody;
    const mosqueSlug = typeof body.mosqueSlug === "string" ? body.mosqueSlug.trim() : "";
    const title = cleanTitle(body.title);
    const description = cleanDescription(body.description);
    const isPaid = Boolean(body.isPaid);
    const offersMonthlyPayment = isPaid ? body.offersMonthlyPayment !== false : false;
    const offersAnnualPayment = isPaid ? Boolean(body.offersAnnualPayment) : false;
    const priceMonthlyCents = Number.isFinite(body.priceMonthlyCents) ? Number(body.priceMonthlyCents) : null;
    const priceAnnualCents = Number.isFinite(body.priceAnnualCents) ? Number(body.priceAnnualCents) : null;
    const trackSelectionMode = body.trackSelectionMode === "minimum" || body.trackSelectionMode === "maximum" ? body.trackSelectionMode : "exact";
    const trackSelectionCount = Number.isFinite(body.trackSelectionCount) ? Math.max(1, Math.round(Number(body.trackSelectionCount))) : 1;
    const requestedDirectorProfileId = typeof body.directorProfileId === "string" && body.directorProfileId.trim() ? body.directorProfileId.trim() : null;

    if (!mosqueSlug) {
      return Response.json({ error: "Missing masjid." }, { status: 400 });
    }

    if (!title) {
      return Response.json({ error: "Program title is required." }, { status: 400 });
    }

    if (isPaid && !offersMonthlyPayment && !offersAnnualPayment) {
      return Response.json({ error: "Choose at least one payment option." }, { status: 400 });
    }

    if (isPaid && offersMonthlyPayment && (!priceMonthlyCents || priceMonthlyCents < 50)) {
      return Response.json({ error: "Monthly payment needs a valid price." }, { status: 400 });
    }

    if (isPaid && offersAnnualPayment && (!priceAnnualCents || priceAnnualCents < 50)) {
      return Response.json({ error: "One-time annual payment needs a valid price." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const [{ data: mosque }, { data: profile }] = await Promise.all([
      supabase.from("mosques").select("*").eq("slug", mosqueSlug).maybeSingle(),
      supabase.from("profiles").select("id, account_type").eq("id", user.id).maybeSingle(),
    ]);

    if (!mosque) {
      return Response.json({ error: "Masjid not found." }, { status: 404 });
    }

    const { data: memberships } = await supabase
      .from("mosque_memberships")
      .select("role, status, can_create_programs")
      .eq("mosque_id", mosque.id)
      .eq("profile_id", user.id);

    const accountType = profile?.account_type?.toLowerCase() ?? null;
    const isMosqueAdmin = accountType === "admin" && (memberships ?? []).some((membership) => membership.role === "admin" && membership.status === "active");
    const teacherMembership = (memberships ?? []).find((membership) => membership.role === "teacher" && membership.status === "active");
    const canTeacherCreate = accountType === "teacher" && Boolean(teacherMembership?.can_create_programs);

    if (!isMosqueAdmin && !canTeacherCreate) {
      return Response.json({ error: "Class creation is not enabled for this account." }, { status: 403 });
    }

    const directorProfileId = isMosqueAdmin ? requestedDirectorProfileId : user.id;
    if (!directorProfileId) {
      return Response.json({ error: "Choose a director for this class." }, { status: 400 });
    }

    const [{ data: directorProfile }, { data: directorMembership }] = await Promise.all([
      supabase.from("profiles").select("id, account_type").eq("id", directorProfileId).maybeSingle(),
      supabase
        .from("mosque_memberships")
        .select("id")
        .eq("mosque_id", mosque.id)
        .eq("profile_id", directorProfileId)
        .eq("role", "teacher")
        .eq("status", "active")
        .maybeSingle(),
    ]);

    if (directorProfile?.account_type !== "teacher" || !directorMembership) {
      return Response.json({ error: "Director must be an active teacher for this masjid." }, { status: 400 });
    }

    let stripeProductId: string | null = null;
    let stripePriceId: string | null = null;
    let stripeAnnualPriceId: string | null = null;
    const stripeRequestOptions = shouldUseStripeConnect() && mosque.stripe_account_id ? { stripeAccount: mosque.stripe_account_id } : undefined;

    if (isPaid) {
      const stripe = getStripe();
      const product = await stripe.products.create(
        {
          name: title,
          description: description ?? undefined,
          metadata: {
            mosque_id: mosque.id,
            mosque_slug: mosque.slug,
          },
        },
        stripeRequestOptions,
      );
      stripeProductId = product.id;
      if (offersMonthlyPayment) {
        const price = await stripe.prices.create(
          {
            product: product.id,
            currency: "cad",
            unit_amount: priceMonthlyCents ?? 0,
            recurring: { interval: "month" },
            metadata: {
              mosque_id: mosque.id,
              mosque_slug: mosque.slug,
              payment_type: "monthly",
            },
          },
          stripeRequestOptions,
        );
        stripePriceId = price.id;
      }
      if (offersAnnualPayment) {
        const annualPrice = await stripe.prices.create(
          {
            product: product.id,
            currency: "cad",
            unit_amount: priceAnnualCents ?? 0,
            metadata: {
              mosque_id: mosque.id,
              mosque_slug: mosque.slug,
              payment_type: "annual",
            },
          },
          stripeRequestOptions,
        );
        stripeAnnualPriceId = annualPrice.id;
      }
    }

    const { data: program, error: programError } = await supabase
      .from("programs")
      .insert({
        mosque_id: mosque.id,
        director_profile_id: directorProfileId,
        title,
        description,
        is_active: true,
        is_paid: isPaid,
        offers_monthly_payment: isPaid ? offersMonthlyPayment : false,
        offers_annual_payment: isPaid ? offersAnnualPayment : false,
        thumbnail_url: typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null,
        audience_gender: typeof body.audienceGender === "string" && body.audienceGender.trim() ? body.audienceGender.trim() : null,
        age_range_text: typeof body.ageRangeText === "string" && body.ageRangeText.trim() ? body.ageRangeText.trim() : null,
        price_monthly_cents: isPaid ? priceMonthlyCents : null,
        price_annual_cents: isPaid ? priceAnnualCents : null,
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
        stripe_annual_price_id: stripeAnnualPriceId,
        schedule: body.schedule ?? null,
        schedule_timezone: body.scheduleTimezone ?? null,
        schedule_notes: body.schedule ? null : "Schedule TBA",
        track_selection_mode: trackSelectionMode,
        track_selection_count: trackSelectionCount,
      })
      .select("*")
      .single();

    if (programError || !program) {
      return Response.json({ error: programError?.message ?? "Could not create program." }, { status: 500 });
    }

    const { error: teacherError } = await supabase.from("program_teachers").upsert(
      {
        program_id: program.id,
        teacher_profile_id: directorProfileId,
        role: "director",
      },
      { onConflict: "program_id,teacher_profile_id" },
    );

    if (teacherError) {
      return Response.json({ error: teacherError.message }, { status: 500 });
    }

    return Response.json({ program });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create program.";
    return Response.json({ error: message }, { status: 500 });
  }
}
