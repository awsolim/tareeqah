import { cancelProgramSubscription } from "@/lib/stripe/subscriptions";
import { sendPushNotification } from "@/lib/push/send-push";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ReviewWithdrawalBody = {
  withdrawalRequestId?: string;
  status?: "approved" | "rejected";
};

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as ReviewWithdrawalBody;
    if (!body.withdrawalRequestId || !body.status) {
      return Response.json({ error: "Missing withdrawal review details." }, { status: 400 });
    }

    if (!["approved", "rejected"].includes(body.status)) {
      return Response.json({ error: "Invalid withdrawal decision." }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: withdrawalRequest, error: requestError } = await supabase
      .from("withdrawal_requests")
      .select("*")
      .eq("id", body.withdrawalRequestId)
      .maybeSingle();

    if (requestError || !withdrawalRequest) {
      return Response.json({ error: requestError?.message ?? "Withdrawal request not found." }, { status: 404 });
    }

    if (withdrawalRequest.status !== "pending") {
      return Response.json({ error: "This withdrawal request has already been reviewed." }, { status: 409 });
    }

    const { data: canManage, error: manageError } = await supabase.rpc("can_manage_program", {
      check_program_id: withdrawalRequest.program_id,
      check_profile_id: user.id,
    });

    if (manageError || !canManage) {
      return Response.json({ error: manageError?.message ?? "You cannot review this withdrawal request." }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { data: program } = await supabase.from("programs").select("title, mosque_id").eq("id", withdrawalRequest.program_id).maybeSingle();
    const { data: mosque } = program ? await supabase.from("mosques").select("slug").eq("id", program.mosque_id).maybeSingle() : { data: null };

    if (body.status === "rejected") {
      const { error: updateError } = await supabase
        .from("withdrawal_requests")
        .update({
          status: "rejected",
          reviewed_by: user.id,
          reviewed_at: now,
          decision_note: "Withdrawal rejected. Enrollment remains active.",
        })
        .eq("id", withdrawalRequest.id);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 });
      }

      if (program && mosque) {
        void sendPushNotification(supabase, {
          recipientProfileIds: [withdrawalRequest.parent_profile_id, withdrawalRequest.student_profile_id],
          title: "Withdrawal request rejected",
          body: `Your withdrawal request for ${program.title} was rejected. Enrollment remains active.`,
          url: `/m/${mosque.slug}/portal/classes`,
        });
      }

      return Response.json({ ok: true });
    }

    const { data: subscription } = await supabase
      .from("program_subscriptions")
      .select("*")
      .eq("program_id", withdrawalRequest.program_id)
      .eq("student_profile_id", withdrawalRequest.student_profile_id)
      .maybeSingle();

    await cancelProgramSubscription(supabase, subscription);

    const { error: updateError } = await supabase
      .from("withdrawal_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        reviewed_at: now,
        decision_note: "Withdrawal approved. Enrollment ended immediately.",
      })
      .eq("id", withdrawalRequest.id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const { error: enrollmentUpdateError } = await supabase
      .from("enrollments")
      .update({ status: "withdrawn" })
      .eq("program_id", withdrawalRequest.program_id)
      .eq("student_profile_id", withdrawalRequest.student_profile_id);

    if (enrollmentUpdateError) {
      return Response.json({ error: enrollmentUpdateError.message }, { status: 500 });
    }

    if (program && mosque) {
      void sendPushNotification(supabase, {
        recipientProfileIds: [withdrawalRequest.parent_profile_id, withdrawalRequest.student_profile_id],
        title: "Withdrawal request approved",
        body: `Your withdrawal request for ${program.title} was approved. Enrollment has ended.`,
        url: `/m/${mosque.slug}/portal/classes`,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review withdrawal request.";
    return Response.json({ error: message }, { status: 500 });
  }
}
