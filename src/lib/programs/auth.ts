import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type ProgramAuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Server-side check for application-decision authority: admin, or a director
 * assigned to this program. Deliberately broader than
 * requireProgramFinanceAccess (which additionally requires the
 * can_manage_finances flag) — approving/waitlisting/rejecting applications is
 * ordinary director authority, not a finance-specific permission.
 */
export async function requireProgramManageAccess(
  supabase: SupabaseClient<Database>,
  programId: string,
  userId: string,
): Promise<ProgramAuthResult> {
  const { data: canManage, error } = await supabase.rpc("can_manage_program", {
    check_program_id: programId,
    check_profile_id: userId,
  });

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!canManage) {
    return { ok: false, status: 403, error: "You don't have permission to manage this class." };
  }
  return { ok: true };
}
