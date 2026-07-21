import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Everyone who manages a program and should hear about it: the primary
 * director/teacher owner plus any additional director-role assignments
 * (multi-director support) — mirrors the same director-resolution logic used
 * throughout the teacher Inbox (director_profile_id ?? teacher_profile_id, plus
 * program_teachers rows with role = 'director').
 */
export async function getProgramManagerProfileIds(
  supabase: SupabaseClient<Database>,
  program: { id: string; director_profile_id: string | null; teacher_profile_id: string | null },
): Promise<string[]> {
  const { data: directorAssignments } = await supabase
    .from("program_teachers")
    .select("teacher_profile_id")
    .eq("program_id", program.id)
    .eq("role", "director")
    .not("teacher_profile_id", "is", null);

  return Array.from(
    new Set(
      [program.director_profile_id ?? program.teacher_profile_id, ...(directorAssignments ?? []).map((row) => row.teacher_profile_id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
}
