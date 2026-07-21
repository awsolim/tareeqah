import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type NotifyBody = {
  announcementId?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  try {
    const { programId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as NotifyBody;
    if (!body.announcementId) {
      return Response.json({ error: "Missing announcement id." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: canManage } = await supabase.rpc("can_manage_program", { check_program_id: programId, check_profile_id: user.id });
    if (!canManage) {
      return Response.json({ error: "You cannot send notifications for this class." }, { status: 403 });
    }

    const { data: announcement } = await supabase
      .from("program_announcements")
      .select("*")
      .eq("id", body.announcementId)
      .eq("program_id", programId)
      .maybeSingle();
    if (!announcement) {
      return Response.json({ error: "Announcement not found." }, { status: 404 });
    }

    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", programId).maybeSingle();
    if (!program) {
      return Response.json({ ok: true });
    }
    const { data: mosque } = await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle();
    if (!mosque) {
      return Response.json({ ok: true });
    }

    const { data: enrollments } = await supabase.from("enrollments").select("id, student_profile_id, program_track_id").eq("program_id", programId);
    const enrollmentIds = (enrollments ?? []).map((enrollment) => enrollment.id);
    const { data: enrollmentTracks } = enrollmentIds.length
      ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
      : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };

    const targetTrackIds = announcement.target_program_track_ids ?? [];
    const qualifyingStudentIds = new Set<string>();
    for (const enrollment of enrollments ?? []) {
      if (targetTrackIds.length === 0) {
        qualifyingStudentIds.add(enrollment.student_profile_id);
        continue;
      }
      const trackIds = [
        ...(enrollmentTracks ?? []).filter((row) => row.enrollment_id === enrollment.id).map((row) => row.program_track_id),
        ...(enrollment.program_track_id ? [enrollment.program_track_id] : []),
      ];
      if (trackIds.some((trackId) => targetTrackIds.includes(trackId))) {
        qualifyingStudentIds.add(enrollment.student_profile_id);
      }
    }

    if (qualifyingStudentIds.size === 0) {
      return Response.json({ ok: true });
    }

    const { data: parentLinks } = await supabase
      .from("parent_child_links")
      .select("parent_profile_id, child_profile_id")
      .in("child_profile_id", Array.from(qualifyingStudentIds));

    const recipientIds = new Set<string>(qualifyingStudentIds);
    for (const link of parentLinks ?? []) {
      recipientIds.add(link.parent_profile_id);
    }

    void sendPushNotification(supabase, {
      recipientProfileIds: Array.from(recipientIds),
      title: `New announcement: ${program.title}`,
      body: announcement.message.length > 140 ? `${announcement.message.slice(0, 137)}...` : announcement.message,
      url: `/m/${mosque.slug}/portal/announcements`,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send announcement notification.";
    return Response.json({ error: message }, { status: 500 });
  }
}
