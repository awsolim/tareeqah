import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

type UpdateProgramBody = {
  title?: string;
  description?: string | null;
  isPaid?: boolean;
  priceMonthlyCents?: number | null;
  thumbnailUrl?: string | null;
  audienceGender?: string | null;
  ageRangeText?: string | null;
  schedule?: Json | null;
  scheduleTimezone?: string | null;
  scheduleNotes?: string | null;
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
    const title = cleanTitle(body.title);
    const description = cleanDescription(body.description);
    const isPaid = Boolean(body.isPaid);
    const priceMonthlyCents = Number.isFinite(body.priceMonthlyCents) ? Number(body.priceMonthlyCents) : null;

    if (!title) {
      return Response.json({ error: "Program title is required." }, { status: 400 });
    }

    if (isPaid && (!priceMonthlyCents || priceMonthlyCents < 50)) {
      return Response.json({ error: "Paid programs need a valid monthly price." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const { data: existingProgram, error: existingError } = await supabase.from("programs").select("*, mosques(*)").eq("id", programId).maybeSingle();
    if (existingError || !existingProgram) {
      return Response.json({ error: existingError?.message ?? "Program not found." }, { status: 404 });
    }

    let stripeProductId = existingProgram.stripe_product_id;
    let stripePriceId = existingProgram.stripe_price_id;
    const mosque = Array.isArray(existingProgram.mosques) ? existingProgram.mosques[0] : existingProgram.mosques;
    const stripeRequestOptions = shouldUseStripeConnect() && mosque?.stripe_account_id ? { stripeAccount: mosque.stripe_account_id } : undefined;

    if (isPaid) {
      const stripe = getStripe();
      if (stripeProductId) {
        await stripe.products.update(
          stripeProductId,
          {
            name: title,
            description: description ?? undefined,
          },
          stripeRequestOptions,
        );
      } else {
        const product = await stripe.products.create(
          {
            name: title,
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

      if (priceMonthlyCents !== existingProgram.price_monthly_cents || !stripePriceId) {
        const price = await stripe.prices.create(
          {
            product: stripeProductId,
            currency: "usd",
            unit_amount: priceMonthlyCents ?? 0,
            recurring: { interval: "month" },
            metadata: {
              mosque_id: existingProgram.mosque_id,
              mosque_slug: mosque?.slug ?? "",
            },
          },
          stripeRequestOptions,
        );
        stripePriceId = price.id;
      }
    } else {
      stripePriceId = null;
    }

    const { data: program, error: updateError } = await supabase
      .from("programs")
      .update({
        title,
        description,
        is_paid: isPaid,
        thumbnail_url: typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() ? body.thumbnailUrl.trim() : null,
        audience_gender: typeof body.audienceGender === "string" && body.audienceGender.trim() ? body.audienceGender.trim() : null,
        age_range_text: typeof body.ageRangeText === "string" && body.ageRangeText.trim() ? body.ageRangeText.trim() : null,
        price_monthly_cents: isPaid ? priceMonthlyCents : null,
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
        schedule: body.schedule ?? null,
        schedule_timezone: body.scheduleTimezone ?? null,
        schedule_notes: body.scheduleNotes ?? null,
      })
      .eq("id", programId)
      .select("*")
      .single();

    if (updateError || !program) {
      return Response.json({ error: updateError?.message ?? "Could not update program." }, { status: 500 });
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
