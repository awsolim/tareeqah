import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getStripe, shouldUseStripeConnect } from "@/lib/stripe/server";

type ProgramSubscriptionRow = Database["public"]["Tables"]["program_subscriptions"]["Row"];

export function isActiveStripeSubscriptionStatus(status: string | null | undefined) {
  return Boolean(status && !["canceled", "incomplete_expired"].includes(status));
}

/**
 * Single canonical path for cancelling a program's Stripe subscription: cancels
 * the live Stripe subscription (if one exists and is still active) and marks
 * the local row canceled. No-op when there's nothing active to cancel, so it's
 * safe to call for manual/free enrollments that never had a Stripe subscription.
 */
export async function cancelProgramSubscription(
  supabase: SupabaseClient<Database>,
  subscription: Pick<ProgramSubscriptionRow, "id" | "stripe_subscription_id" | "stripe_account_id" | "status"> | null | undefined,
): Promise<void> {
  if (!subscription?.stripe_subscription_id || !isActiveStripeSubscriptionStatus(subscription.status)) {
    return;
  }

  const stripeOptions =
    shouldUseStripeConnect() && subscription.stripe_account_id ? { stripeAccount: subscription.stripe_account_id } : undefined;
  await getStripe().subscriptions.cancel(subscription.stripe_subscription_id, {}, stripeOptions);

  await supabase
    .from("program_subscriptions")
    .update({
      status: "canceled",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);
}
