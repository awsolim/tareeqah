import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export function createSupabaseServerClient() {
  const { url, anonKey } = getSupabasePublicEnv();

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
    },
  });
}
