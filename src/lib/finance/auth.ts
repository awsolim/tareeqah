import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type FinanceAuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Server-side mirror of the admin-or-finance-enabled-director check the
 * finance UI already runs client-side, so Stripe-touching routes don't rely
 * solely on a browser check before moving money.
 */
export async function requireProgramFinanceAccess(
  supabase: SupabaseClient<Database>,
  programId: string,
  userId: string,
): Promise<FinanceAuthResult> {
  const { data: canManage, error } = await supabase.rpc("can_manage_program_finances", {
    check_program_id: programId,
    check_profile_id: userId,
  });

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!canManage) {
    return { ok: false, status: 403, error: "Finance access has not been enabled for this class." };
  }
  return { ok: true };
}
