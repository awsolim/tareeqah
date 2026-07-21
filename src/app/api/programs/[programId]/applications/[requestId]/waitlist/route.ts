import { requireProgramManageAccess } from "@/lib/programs/auth";
import { recordFinanceAuditEvent } from "@/lib/finance/audit";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type WaitlistRequestBody = {
  note?: string | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ programId: string; requestId: string }> }) {
  try {
    const { programId, requestId } = await params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const access = await requireProgramManageAccess(supabase, programId, user.id);
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json().catch(() => ({}))) as WaitlistRequestBody;

    const { data: enrollmentRequest, error: requestError } = await supabase
      .from("enrollment_requests")
      .select("*")
      .eq("id", requestId)
      .eq("program_id", programId)
      .maybeSingle();
    if (requestError || !enrollmentRequest) {
      return Response.json({ error: requestError?.message ?? "Application not found." }, { status: 404 });
    }
    if (enrollmentRequest.status !== "pending") {
      return Response.json({ error: "Only a pending application can be waitlisted." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const note = body.note?.trim() || null;
    const { error: updateError } = await supabase
      .from("enrollment_requests")
      .update({ status: "waitlisted", reviewed_by: user.id, reviewed_at: now, review_note: note, decision_note: note })
      .eq("id", requestId);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const { data: student } = await supabase.from("profiles").select("full_name, email").eq("id", enrollmentRequest.student_profile_id).maybeSingle();
    await recordFinanceAuditEvent(supabase, {
      programId,
      studentProfileId: enrollmentRequest.student_profile_id,
      actorProfileId: user.id,
      eventType: "application_waitlisted",
      summary: `${student?.full_name || student?.email || "This student"}'s application was waitlisted.`,
    });

    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", programId).maybeSingle();
    const { data: mosque } = program ? await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle() : { data: null };
    if (program && mosque) {
      void sendPushNotification(supabase, {
        recipientProfileIds: [enrollmentRequest.parent_profile_id, enrollmentRequest.student_profile_id],
        title: "Application waitlisted",
        body: `${student?.full_name || "Your"} application to ${program.title} was waitlisted.`,
        url: `/m/${mosque.slug}/portal/classes?tab=applications`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not waitlist application.";
    return Response.json({ error: message }, { status: 500 });
  }
}
