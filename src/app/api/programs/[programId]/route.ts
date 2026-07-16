import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

type UpdateProgramBody = {
  internalName?: string | null;
  title?: string;
  summary?: string | null;
  description?: string | null;
  category?: string | null;
  programType?: string;
  publicationStatus?: string;
  applicationStatus?: string;
  lifecycleStatus?: string;
  applicationMode?: string;
  acceptingApplications?: boolean;
  applicationOpenAt?: string | null;
  applicationCloseAt?: string | null;
  waitlistEnabled?: boolean;
  capacityBehavior?: string;
  defaultCapacity?: number | null;
  durationType?: string;
  startNow?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  durationMonths?: number | null;
  schedulePattern?: string;
  registrationDeadlineAt?: string | null;
  location?: string | null;
  room?: string | null;
  paymentKind?: string;
  billingStartBehavior?: string;
  billingEndBehavior?: string;
  billingDurationMonths?: number | null;
  allowCustomPrices?: boolean;
  allowWaivedPayments?: boolean;
  manualPaymentNote?: string | null;
  financialAssistanceNote?: string | null;
  receiptNote?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
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
  scheduleNotes?: string | null;
  trackSelectionMode?: string;
  trackSelectionCount?: number;
  directorProfileId?: string | null;
  tags?: unknown;
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

function cleanText(value: unknown, max = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function pickAllowed(value: unknown, allowed: string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function cleanDateTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const tags = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 40))
    .filter(Boolean);
  return tags.length ? Array.from(new Set(tags)).slice(0, 12) : null;
}

async function getAuthenticatedUserId(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return { userId: null, error: "Not authenticated." };
  }

  const supabase = createSupabaseServiceClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { userId: null, error: "Not authenticated." };
  }

  return { userId: user.id, error: null };
}

async function canManageProgram(programId: string, userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("can_manage_program", {
    check_program_id: programId,
    check_profile_id: userId,
  });
  return !error && Boolean(data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const auth = await getAuthenticatedUserId(request);
    if (!auth.userId) {
      return Response.json({ error: auth.error }, { status: 401 });
    }

    if (!(await canManageProgram(programId, auth.userId))) {
      return Response.json({ error: "Director access required." }, { status: 403 });
    }

    const body = (await request.json()) as UpdateProgramBody;
    const internalName = cleanText(body.internalName, 160);
    const title = cleanTitle(body.title);
    const summary = cleanText(body.summary, 400);
    const description = cleanDescription(body.description);
    const publicationStatus = pickAllowed(body.publicationStatus, ["draft", "published", "hidden", "archived"], "published");
    const applicationStatus = pickAllowed(body.applicationStatus, ["accepting", "not_accepting", "waitlist_only", "closed", "invite_only"], "accepting");
    const lifecycleStatus = pickAllowed(body.lifecycleStatus, ["upcoming", "active", "completed", "cancelled", "archived"], "upcoming");
    const applicationMode = pickAllowed(body.applicationMode, ["application_required", "open_enrollment", "invite_only", "hidden_private"], "application_required");
    const durationType = pickAllowed(body.durationType, ["ongoing", "fixed_months"], "ongoing");
    const paymentKind = pickAllowed(body.paymentKind, ["free", "tareeqah", "manual"], "free");
    const isPaid = paymentKind === "tareeqah";
    const offersMonthlyPayment = isPaid ? body.offersMonthlyPayment !== false : false;
    const offersAnnualPayment = isPaid ? Boolean(body.offersAnnualPayment) : false;
    const priceMonthlyCents = Number.isFinite(body.priceMonthlyCents) ? Number(body.priceMonthlyCents) : null;
    const priceAnnualCents = Number.isFinite(body.priceAnnualCents) ? Number(body.priceAnnualCents) : null;
    const trackSelectionMode = body.trackSelectionMode === "minimum" || body.trackSelectionMode === "maximum" ? body.trackSelectionMode : "exact";
    const trackSelectionCount = Number.isFinite(body.trackSelectionCount) ? Math.max(1, Math.round(Number(body.trackSelectionCount))) : 1;
    const requestedDirectorProfileId = typeof body.directorProfileId === "string" && body.directorProfileId.trim() ? body.directorProfileId.trim() : null;
    const isDraft = publicationStatus === "draft";

    if (!title && !internalName) {
      return Response.json({ error: "Add an internal name or public title before saving." }, { status: 400 });
    }

    if (!isDraft && isPaid && !offersMonthlyPayment && !offersAnnualPayment) {
      return Response.json({ error: "Choose at least one payment option." }, { status: 400 });
    }

    if (!isDraft && isPaid && offersMonthlyPayment && (!priceMonthlyCents || priceMonthlyCents < 50)) {
      return Response.json({ error: "Monthly payment needs a valid price." }, { status: 400 });
    }

    if (!isDraft && isPaid && offersAnnualPayment && (!priceAnnualCents || priceAnnualCents < 50)) {
      return Response.json({ error: "One-time annual payment needs a valid price." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const { data: existingProgram, error: existingError } = await supabase.from("programs").select("*, mosques(*)").eq("id", programId).maybeSingle();
    if (existingError || !existingProgram) {
      return Response.json({ error: existingError?.message ?? "Program not found." }, { status: 404 });
    }

    let nextDirectorProfileId: string | null | undefined;
    if (requestedDirectorProfileId) {
      const [{ data: viewerProfile }, { data: adminMembership }, { data: directorProfile }, { data: directorMembership }] = await Promise.all([
        supabase.from("profiles").select("id, account_type").eq("id", auth.userId).maybeSingle(),
        supabase
          .from("mosque_memberships")
          .select("id")
          .eq("mosque_id", existingProgram.mosque_id)
          .eq("profile_id", auth.userId)
          .eq("role", "admin")
          .eq("status", "active")
          .maybeSingle(),
        supabase.from("profiles").select("id, account_type").eq("id", requestedDirectorProfileId).maybeSingle(),
        supabase
          .from("mosque_memberships")
          .select("id")
          .eq("mosque_id", existingProgram.mosque_id)
          .eq("profile_id", requestedDirectorProfileId)
          .eq("role", "teacher")
          .eq("status", "active")
          .maybeSingle(),
      ]);

      if (viewerProfile?.account_type !== "admin" || !adminMembership) {
        return Response.json({ error: "Admin access is required to change the director." }, { status: 403 });
      }

      if (directorProfile?.account_type !== "teacher" || !directorMembership) {
        return Response.json({ error: "Director must be an active teacher for this masjid." }, { status: 400 });
      }

      nextDirectorProfileId = requestedDirectorProfileId;
    }

    let stripeProductId = existingProgram.stripe_product_id;
    let stripePriceId = existingProgram.stripe_price_id;
    let stripeAnnualPriceId = existingProgram.stripe_annual_price_id;
    const mosque = Array.isArray(existingProgram.mosques) ? existingProgram.mosques[0] : existingProgram.mosques;
    const stripeRequestOptions = shouldUseStripeConnect() && mosque?.stripe_account_id ? { stripeAccount: mosque.stripe_account_id } : undefined;

    if (isPaid && !isDraft) {
      const stripe = getStripe();
      if (stripeProductId) {
        await stripe.products.update(
          stripeProductId,
          {
            name: title || internalName || "Untitled Program",
            description: description ?? undefined,
          },
          stripeRequestOptions,
        );
      } else {
        const product = await stripe.products.create(
          {
            name: title || internalName || "Untitled Program",
            description: description ?? undefined,
            metadata: {
              mosque_id: existingProgram.mosque_id,
              mosque_slug: mosque?.slug ?? "",
            },
          },
          stripeRequestOptions,
        );
        stripeProductId = product.id;
      }

      if (offersMonthlyPayment && (priceMonthlyCents !== existingProgram.price_monthly_cents || !stripePriceId)) {
        const price = await stripe.prices.create(
          {
            product: stripeProductId,
            currency: "cad",
            unit_amount: priceMonthlyCents ?? 0,
            recurring: { interval: "month" },
            metadata: {
              mosque_id: existingProgram.mosque_id,
              mosque_slug: mosque?.slug ?? "",
              payment_type: "monthly",
            },
          },
          stripeRequestOptions,
        );
        stripePriceId = price.id;
      }
      if (!offersMonthlyPayment) {
        stripePriceId = null;
      }
      if (offersAnnualPayment && (priceAnnualCents !== existingProgram.price_annual_cents || !stripeAnnualPriceId)) {
        const annualPrice = await stripe.prices.create(
          {
            product: stripeProductId,
            currency: "cad",
            unit_amount: priceAnnualCents ?? 0,
            metadata: {
              mosque_id: existingProgram.mosque_id,
              mosque_slug: mosque?.slug ?? "",
              payment_type: "annual",
            },
          },
          stripeRequestOptions,
        );
        stripeAnnualPriceId = annualPrice.id;
      }
      if (!offersAnnualPayment) {
        stripeAnnualPriceId = null;
      }
    } else {
      stripePriceId = null;
      stripeAnnualPriceId = null;
    }

    const updatePayload = {
      internal_name: internalName,
      title: title || internalName || "Untitled Draft",
      summary,
      description,
      category: cleanText(body.category, 80),
      program_type: pickAllowed(body.programType, ["recurring", "event"], "recurring"),
      publication_status: publicationStatus,
      application_status: publicationStatus === "draft" ? "not_accepting" : applicationStatus,
      lifecycle_status: lifecycleStatus,
      application_mode: applicationMode,
      accepting_applications: publicationStatus !== "draft" && body.acceptingApplications !== false,
      application_open_at: cleanDateTime(body.applicationOpenAt),
      application_close_at: cleanDateTime(body.applicationCloseAt),
      waitlist_enabled: body.waitlistEnabled !== false,
      capacity_behavior: pickAllowed(body.capacityBehavior, ["manual_review", "close_when_full", "allow_waitlist"], "manual_review"),
      default_capacity: Number.isFinite(body.defaultCapacity) ? Math.max(0, Math.round(Number(body.defaultCapacity))) : null,
      tags: cleanTags(body.tags),
      duration_type: durationType,
      start_now: Boolean(body.startNow),
      start_date: body.startNow ? null : typeof body.startDate === "string" && body.startDate.trim() ? body.startDate : null,
      end_date: null,
      duration_months: Number.isFinite(body.durationMonths) ? Math.max(1, Math.round(Number(body.durationMonths))) : null,
      is_ongoing: durationType === "ongoing",
      schedule_pattern: pickAllowed(body.schedulePattern, ["weekly", "custom_dates"], "weekly"),
      registration_deadline_at: cleanDateTime(body.registrationDeadlineAt),
      location: cleanText(body.location, 180),
      room: cleanText(body.room, 120),
      is_active: publicationStatus !== "draft" && lifecycleStatus !== "cancelled" && lifecycleStatus !== "archived",
      is_paid: isPaid,
      payment_kind: paymentKind,
      offers_monthly_payment: isPaid ? offersMonthlyPayment : false,
      offers_annual_payment: isPaid ? offersAnnualPayment : false,
      billing_start_behavior: pickAllowed(body.billingStartBehavior, ["on_payment", "program_start"], "on_payment"),
      billing_end_behavior: pickAllowed(body.billingEndBehavior, ["manual_cancel", "program_end", "fixed_months"], "fixed_months"),
      billing_duration_months: Number.isFinite(body.billingDurationMonths) ? Math.max(1, Math.round(Number(body.billingDurationMonths))) : 10,
      allow_custom_prices: body.allowCustomPrices !== false,
      allow_waived_payments: body.allowWaivedPayments !== false,
      manual_payment_note: cleanText(body.manualPaymentNote, 1000),
      financial_assistance_note: cleanText(body.financialAssistanceNote, 1000),
      receipt_note: cleanText(body.receiptNote, 1000),
      contact_name: cleanText(body.contactName, 120),
      contact_email: cleanText(body.contactEmail, 180),
      contact_phone: cleanText(body.contactPhone, 60),
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
      schedule_notes: body.scheduleNotes ?? null,
      track_selection_mode: trackSelectionMode,
      track_selection_count: trackSelectionCount,
      ...(nextDirectorProfileId ? { director_profile_id: nextDirectorProfileId } : {}),
    };

    const { data: program, error: updateError } = await supabase
      .from("programs")
      .update(updatePayload)
      .eq("id", programId)
      .select("*")
      .single();

    if (updateError || !program) {
      return Response.json({ error: updateError?.message ?? "Could not update program." }, { status: 500 });
    }

    if (nextDirectorProfileId) {
      await supabase.from("program_teachers").delete().eq("program_id", programId).eq("role", "director");
      const { error: teacherError } = await supabase.from("program_teachers").upsert(
        {
          program_id: programId,
          teacher_profile_id: nextDirectorProfileId,
          role: "director",
        },
        { onConflict: "program_id,teacher_profile_id" },
      );

      if (teacherError) {
        return Response.json({ error: teacherError.message }, { status: 500 });
      }
    }

    return Response.json({ program });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update program.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const auth = await getAuthenticatedUserId(request);
    if (!auth.userId) {
      return Response.json({ error: auth.error }, { status: 401 });
    }

    if (!(await canManageProgram(programId, auth.userId))) {
      return Response.json({ error: "Director access required." }, { status: 403 });
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("programs").delete().eq("id", programId);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete program.";
    return Response.json({ error: message }, { status: 500 });
  }
}
