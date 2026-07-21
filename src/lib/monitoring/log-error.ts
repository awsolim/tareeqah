import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Durable, zero-external-dependency error logging for server code paths that would
 * otherwise fail silently (a caught error just turned into a JSON response, with no
 * record anywhere). Always console.errors too, so it's visible in platform function logs
 * even before anyone queries the table. Never throws — a logging failure must never mask
 * or replace the original error it was trying to record.
 */
export async function logServerError(
  supabase: SupabaseClient<Database>,
  event: { source: string; message: string; context?: Record<string, Json> },
) {
  console.error(`[${event.source}]`, event.message, event.context ?? "");
  try {
    await supabase.from("system_error_logs").insert({
      source: event.source,
      message: event.message,
      context: event.context ?? null,
    });
  } catch (error) {
    console.error("Failed to persist system_error_logs row:", error instanceof Error ? error.message : error);
  }
}
