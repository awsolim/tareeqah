import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/** Appends to program_finance_audit_events — the trail shown on the finance page. */
export async function recordFinanceAuditEvent(
  supabase: SupabaseClient<Database>,
  event: {
    programId: string;
    studentProfileId?: string | null;
    actorProfileId: string | null;
    eventType: string;
    summary: string;
    metadata?: Record<string, Json>;
  },
) {
  await supabase.from("program_finance_audit_events").insert({
    program_id: event.programId,
    student_profile_id: event.studentProfileId ?? null,
    actor_profile_id: event.actorProfileId,
    event_type: event.eventType,
    summary: event.summary,
    metadata: event.metadata ?? {},
  });
}
