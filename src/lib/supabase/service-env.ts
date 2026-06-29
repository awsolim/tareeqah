import "server-only";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseServiceEnv() {
  return {
    ...getSupabasePublicEnv(),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
