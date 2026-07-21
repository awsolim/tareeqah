"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";

let client: ReturnType<typeof createClient<Database>> | undefined;

export function createSupabaseBrowserClient() {
  if (client) {
    return client;
  }

  const { url, anonKey } = getSupabasePublicEnv();
  client = createClient<Database>(url, anonKey, {
    global: { fetch: fetchWithTimeout() },
  });

  return client;
}
