import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getSupabaseServiceEnv();

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: fetchWithTimeout() },
  });
}
