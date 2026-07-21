import { getProgramManagerProfileIds } from "@/lib/push/program-recipients";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type NotifyBody = {
  eventType?: "joined" | "resigned";
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
    if (body.eventType !== "joined" && body.eventType !== "resigned") {
      return Response.json({ error: "Invalid event type." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    if (body.eventType === "joined") {
      const { data: assignment } = await supabase
        .from("program_teachers")
        .select("id")
        .eq("program_id", programId)
        .eq("teacher_profile_id", user.id)
        .eq("role", "instructor")
        .maybeSingle();
      if (!assignment) {
        return Response.json({ error: "No matching instructor assignment found." }, { status: 403 });
      }
    } else {
      const { data: event } = await supabase
        .from("program_instructor_events")
        .select("created_at")
        .eq("program_id", programId)
        .eq("teacher_profile_id", user.id)
        .eq("event_type", "resigned")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!event || Date.now() - Date.parse(event.created_at) > 60_000) {
        return Response.json({ error: "No recent resignation found." }, { status: 403 });
      }
    }

    const { data: program } = await supabase
      .from("programs")
      .select("title, mosque_id, director_profile_id, teacher_profile_id")
      .eq("id", programId)
      .maybeSingle();
    if (!program) {
      return Response.json({ ok: true });
    }

    const { data: mosque } = await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle();
    const { data: instructor } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
    const instructorLabel = instructor?.full_name || instructor?.email || "An instructor";
    const managerIds = (await getProgramManagerProfileIds(supabase, { id: programId, ...program })).filter((id) => id !== user.id);

    if (mosque && managerIds.length) {
      void sendPushNotification(supabase, {
        recipientProfileIds: managerIds,
        title: body.eventType === "joined" ? "Instructor joined" : "Instructor resigned",
        body:
          body.eventType === "joined"
            ? `${instructorLabel} joined ${program.title} as an instructor.`
            : `${instructorLabel} resigned as an instructor of ${program.title}.`,
        url: `/m/${mosque.slug}/teacher/classes/${programId}/instructors`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send instructor notification.";
    return Response.json({ error: message }, { status: 500 });
  }
}
