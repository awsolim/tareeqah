import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type NotifyBody = {
  noteId?: string;
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
    if (!body.noteId) {
      return Response.json({ error: "Missing note id." }, { status: 400 });
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

    const { data: note } = await supabase
      .from("program_student_notes")
      .select("*")
      .eq("id", body.noteId)
      .eq("program_id", programId)
      .maybeSingle();
    if (!note) {
      return Response.json({ error: "Note not found." }, { status: 404 });
    }

    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", programId).maybeSingle();
    if (!program) {
      return Response.json({ ok: true });
    }
    const { data: mosque } = await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle();
    if (!mosque) {
      return Response.json({ ok: true });
    }

    void sendPushNotification(supabase, {
      recipientProfileIds: [note.recipient_profile_id],
      title: `New note: ${program.title}`,
      body: note.message.length > 140 ? `${note.message.slice(0, 137)}...` : note.message,
      url: `/m/${mosque.slug}/portal/announcements?tab=notes`,
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send note notification.";
    return Response.json({ error: message }, { status: 500 });
  }
}
