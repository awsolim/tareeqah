import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/supabase/types";
import { deriveLifecycleStatus, normalizeProgramStatusFields, validateProgramStatusCombination, type ProgramStatusFields } from "@/lib/programs/status";

export const runtime = "nodejs";

type CreateProgramBody = {
  mosqueSlug?: string;
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
  roomArea?: string | null;
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
  coverPriceLabelEnabled?: boolean;
  coverPriceLabel?: string | null;
  isPaid?: boolean;
  offersMonthlyPayment?: boolean;
  offersAnnualPayment?: boolean;
  usesPerTrackPricing?: boolean;
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
  tags?: unknown;
};

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

const optionalProgramBuilderColumns = new Set([
  "internal_name",
  "summary",
  "category",
  "program_type",
  "publication_status",
  "application_status",
  "lifecycle_status",
  "application_mode",
  "accepting_applications",
  "application_open_at",
  "application_close_at",
  "waitlist_enabled",
  "capacity_behavior",
  "default_capacity",
  "tags",
  "duration_type",
  "start_now",
  "start_date",
  "end_date",
  "duration_months",
  "is_ongoing",
  "schedule_pattern",
  "registration_deadline_at",
  "location",
  "room",
  "room_area",
  "payment_kind",
  "billing_start_behavior",
  "billing_end_behavior",
  "billing_duration_months",
  "offers_monthly_payment",
  "offers_annual_payment",
  "allow_custom_prices",
  "allow_waived_payments",
  "manual_payment_note",
  "financial_assistance_note",
  "receipt_note",
  "contact_name",
  "contact_email",
  "contact_phone",
  "cover_price_label_enabled",
  "cover_price_label",
  "price_annual_cents",
  "stripe_annual_price_id",
  "track_selection_mode",
  "track_selection_count",
]);

type ProgramInsert = Database["public"]["Tables"]["programs"]["Insert"];

function schemaCacheMissingColumn(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return message.match(/Could not find the '([^']+)' column/)?.[1] ?? null;
}

async function insertProgramWithSchemaFallback(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  payload: Record<string, unknown>,
) {
  const nextPayload = { ...payload };
  let lastError: { message?: string } | null = null;

  for (let attempt = 0; attempt < optionalProgramBuilderColumns.size + 1; attempt += 1) {
    const { data, error } = await supabase.from("programs").insert(nextPayload as ProgramInsert).select("*").single();
    if (!error) {
      return { data, error: null };
    }

    lastError = error;
    const missingColumn = schemaCacheMissingColumn(error);
    if (!missingColumn || !optionalProgramBuilderColumns.has(missingColumn) || !(missingColumn in nextPayload)) {
      return { data: null, error };
    }
    delete nextPayload[missingColumn];
  }

  return { data: null, error: lastError };
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
    const summary = cleanText(body.summary, 400);
    const description = cleanDescription(body.description);
    const publicationStatus = pickAllowed(body.publicationStatus, ["draft", "published", "hidden", "archived"], "published");
    const applicationStatus = pickAllowed(body.applicationStatus, ["accepting", "not_accepting", "opens_later", "waitlist_only", "closed", "invite_only"], "accepting");
    const lifecycleStatus = pickAllowed(body.lifecycleStatus, ["upcoming", "active", "paused", "completed", "cancelled", "archived"], "upcoming");
    const applicationMode = pickAllowed(body.applicationMode, ["application_required", "open_enrollment", "invite_only", "hidden_private"], "application_required");
    const durationType = pickAllowed(body.durationType, ["ongoing", "fixed_months"], "ongoing");
    const paymentKind = pickAllowed(body.paymentKind, ["free", "tareeqah"], "free");
    const isPaid = paymentKind === "tareeqah";
    const offersMonthlyPayment = isPaid ? body.offersMonthlyPayment !== false : false;
    const offersAnnualPayment = isPaid ? Boolean(body.offersAnnualPayment) : false;
    const usesPerTrackPricing = isPaid && body.usesPerTrackPricing === true;
    const priceMonthlyCents = Number.isFinite(body.priceMonthlyCents) ? Number(body.priceMonthlyCents) : null;
    const priceAnnualCents = Number.isFinite(body.priceAnnualCents) ? Number(body.priceAnnualCents) : null;
    const trackSelectionMode = "exact";
    const trackSelectionCount = 1;
    const requestedDirectorProfileId = typeof body.directorProfileId === "string" && body.directorProfileId.trim() ? body.directorProfileId.trim() : null;
    const isDraft = publicationStatus === "draft";
    const billingEndBehavior = pickAllowed(body.billingEndBehavior, ["manual_cancel", "program_end", "fixed_months"], "fixed_months");
    const endDateValue = durationType === "ongoing" ? null : typeof body.endDate === "string" && body.endDate.trim() ? body.endDate : null;
    const startDateValue = body.startNow ? null : typeof body.startDate === "string" && body.startDate.trim() ? body.startDate : null;
    const applicationOpenAtValue = cleanDateTime(body.applicationOpenAt);
    const applicationCloseAtValue = cleanDateTime(body.applicationCloseAt);
    const derivedLifecycleStatus = deriveLifecycleStatus({
      lifecycleStatus: lifecycleStatus as ProgramStatusFields["lifecycleStatus"],
      startNow: Boolean(body.startNow),
      startDate: startDateValue,
      endDate: endDateValue,
      isOngoing: durationType === "ongoing",
    });
    const statusFields = normalizeProgramStatusFields({
      publicationStatus: publicationStatus as ProgramStatusFields["publicationStatus"],
      applicationStatus: applicationStatus as ProgramStatusFields["applicationStatus"],
      lifecycleStatus: derivedLifecycleStatus,
      applicationOpenAt: applicationOpenAtValue,
      applicationCloseAt: applicationCloseAtValue,
      startDate: startDateValue,
      endDate: endDateValue,
      isOngoing: durationType === "ongoing",
      billingEndBehavior: billingEndBehavior as ProgramStatusFields["billingEndBehavior"],
      offersAnnualPayment,
    });

    if (!mosqueSlug) {
      return Response.json({ error: "Missing masjid." }, { status: 400 });
    }

    if (!title) {
      return Response.json({ error: "Add a public title before saving." }, { status: 400 });
    }

    if (!isDraft) {
      const validation = validateProgramStatusCombination(statusFields);
      if (!validation.valid) {
        return Response.json({ error: validation.errors[0]?.message ?? "Invalid program status combination." }, { status: 400 });
      }
    }

    if (!isDraft && isPaid && !offersMonthlyPayment && !offersAnnualPayment) {
      return Response.json({ error: "Choose at least one payment option." }, { status: 400 });
    }

    if (!isDraft && isPaid && !usesPerTrackPricing && offersMonthlyPayment && (!priceMonthlyCents || priceMonthlyCents < 50)) {
      return Response.json({ error: "Monthly payment needs a valid price." }, { status: 400 });
    }

    if (!isDraft && isPaid && !usesPerTrackPricing && offersAnnualPayment && (!priceAnnualCents || priceAnnualCents < 50)) {
      return Response.json({ error: "Pay in Full needs a valid price." }, { status: 400 });
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

    if (isPaid && !isDraft) {
      const stripe = getStripe();
      const product = await stripe.products.create(
        {
          name: title || "Untitled Program",
          description: description ?? undefined,
          metadata: {
            mosque_id: mosque.id,
            mosque_slug: mosque.slug,
          },
        },
        stripeRequestOptions,
      );
      stripeProductId = product.id;
      if (offersMonthlyPayment && !usesPerTrackPricing) {
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
      if (offersAnnualPayment && !usesPerTrackPricing) {
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

    const programInsert = {
        mosque_id: mosque.id,
        director_profile_id: directorProfileId,
        internal_name: null,
        title: title || "Untitled Draft",
        summary,
        description,
        category: cleanText(body.category, 80),
        program_type: pickAllowed(body.programType, ["recurring", "event"], "recurring"),
        publication_status: publicationStatus,
        application_status: statusFields.applicationStatus,
        lifecycle_status: derivedLifecycleStatus,
        application_mode: applicationMode,
        accepting_applications: statusFields.applicationStatus === "accepting",
        application_open_at: applicationOpenAtValue,
        application_close_at: applicationCloseAtValue,
        waitlist_enabled: body.waitlistEnabled !== false,
        capacity_behavior: pickAllowed(body.capacityBehavior, ["manual_review", "close_when_full", "allow_waitlist"], "manual_review"),
        default_capacity: Number.isFinite(body.defaultCapacity) ? Math.max(0, Math.round(Number(body.defaultCapacity))) : null,
        tags: cleanTags(body.tags),
        duration_type: durationType,
        start_now: Boolean(body.startNow),
        start_date: startDateValue,
        end_date: endDateValue,
        duration_months: Number.isFinite(body.durationMonths) ? Math.max(1, Math.round(Number(body.durationMonths))) : null,
        is_ongoing: durationType === "ongoing",
        schedule_pattern: pickAllowed(body.schedulePattern, ["weekly", "custom_dates"], "weekly"),
        registration_deadline_at: cleanDateTime(body.registrationDeadlineAt),
        location: cleanText(body.location, 180),
        room: cleanText(body.room, 120),
        room_area: cleanText(body.roomArea, 120),
        is_active: publicationStatus !== "draft" && derivedLifecycleStatus !== "cancelled" && derivedLifecycleStatus !== "archived",
        is_paid: isPaid,
        payment_kind: paymentKind,
        billing_start_behavior: pickAllowed(body.billingStartBehavior, ["on_payment", "program_start"], "on_payment"),
        billing_end_behavior: billingEndBehavior,
        billing_duration_months: Number.isFinite(body.billingDurationMonths) ? Math.max(1, Math.round(Number(body.billingDurationMonths))) : 10,
        offers_monthly_payment: isPaid ? offersMonthlyPayment : false,
        offers_annual_payment: isPaid ? offersAnnualPayment : false,
        allow_custom_prices: body.allowCustomPrices !== false,
        allow_waived_payments: body.allowWaivedPayments !== false,
        manual_payment_note: cleanText(body.manualPaymentNote, 1000),
        financial_assistance_note: cleanText(body.financialAssistanceNote, 1000),
        receipt_note: cleanText(body.receiptNote, 1000),
        contact_name: cleanText(body.contactName, 120),
        contact_email: cleanText(body.contactEmail, 180),
        contact_phone: cleanText(body.contactPhone, 60),
        cover_price_label_enabled: body.coverPriceLabelEnabled !== false,
        cover_price_label: cleanText(body.coverPriceLabel, 80),
        thumbnail_url: typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null,
        audience_gender: typeof body.audienceGender === "string" && body.audienceGender.trim() ? body.audienceGender.trim() : null,
        age_range_text: typeof body.ageRangeText === "string" && body.ageRangeText.trim() ? body.ageRangeText.trim() : null,
        price_monthly_cents: isPaid && !usesPerTrackPricing ? priceMonthlyCents : null,
        price_annual_cents: isPaid && !usesPerTrackPricing ? priceAnnualCents : null,
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
        stripe_annual_price_id: stripeAnnualPriceId,
        schedule: body.schedule ?? null,
        schedule_timezone: body.scheduleTimezone ?? null,
        schedule_notes: body.schedule ? null : "Schedule TBA",
        track_selection_mode: trackSelectionMode,
        track_selection_count: trackSelectionCount,
      };

    const { data: program, error: programError } = await insertProgramWithSchemaFallback(supabase, programInsert);

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
