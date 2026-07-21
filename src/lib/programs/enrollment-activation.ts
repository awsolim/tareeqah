import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type SupaClient = SupabaseClient<Database>;

export async function selectedTrackIdsForRequest(supabase: SupaClient, enrollmentRequestId: string, fallbackTrackId: string | null): Promise<string[]> {
  const { data } = await supabase.from("enrollment_request_tracks").select("program_track_id").eq("enrollment_request_id", enrollmentRequestId);
  const trackIds = (data ?? []).map((row) => row.program_track_id).filter((id): id is string => Boolean(id));
  return trackIds.length ? trackIds : fallbackTrackId ? [fallbackTrackId] : [];
}

export async function replaceEnrollmentTracks(supabase: SupaClient, enrollmentId: string, trackIds: string[]) {
  await supabase.from("enrollment_tracks").delete().eq("enrollment_id", enrollmentId);
  if (trackIds.length) {
    await supabase.from("enrollment_tracks").insert(trackIds.map((trackId) => ({ enrollment_id: enrollmentId, program_track_id: trackId })));
  }
}

/**
 * The single place enrollment activation happens once an approved
 * application is completed — called from the free/waived confirm endpoint,
 * the Stripe webhook, and the client-triggered Stripe confirm fallback, so
 * all three paths leave enrollment_requests/enrollments in identical state
 * instead of each maintaining its own slightly-different copy.
 */
export async function activateEnrollmentForRequest(
  supabase: SupaClient,
  params: { enrollmentRequestId: string; programId: string; studentProfileId: string; fallbackTrackId: string | null },
): Promise<string[]> {
  const trackIds = await selectedTrackIdsForRequest(supabase, params.enrollmentRequestId, params.fallbackTrackId);

  const { data: enrollment } = await supabase
    .from("enrollments")
    .upsert(
      {
        program_id: params.programId,
        student_profile_id: params.studentProfileId,
        program_track_id: trackIds[0] ?? params.fallbackTrackId,
        status: "active",
        // Explicitly refreshed so a student who withdraws and later re-joins the same
        // program gets a fresh join date instead of Postgres silently keeping the
        // original insert's default (announcement notifications key off this).
        created_at: new Date().toISOString(),
      },
      { onConflict: "program_id,student_profile_id" },
    )
    .select("id")
    .single();

  if (enrollment) {
    await replaceEnrollmentTracks(supabase, enrollment.id, trackIds);
  }

  const now = new Date().toISOString();
  await supabase
    .from("enrollment_requests")
    .update({ admission_completed_at: now, student_dismissed_at: now, teacher_dismissed_at: null })
    .eq("id", params.enrollmentRequestId);

  return trackIds;
}
