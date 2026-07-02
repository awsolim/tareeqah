import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/types";
import { escapeHtml, getAppBaseUrl, sendEmail } from "@/lib/email/resend";

type EnrollmentRequest = Database["public"]["Tables"]["enrollment_requests"]["Row"];
type Program = Database["public"]["Tables"]["programs"]["Row"];
type Mosque = Database["public"]["Tables"]["mosques"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type EnrollmentEmailContext = {
  request: EnrollmentRequest;
  program: Program;
  mosque: Mosque;
  student: Profile | null;
  parent: Profile | null;
  teacher: Profile | null;
};

function compactIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function profileName(profile: Pick<Profile, "full_name" | "email"> | null | undefined, fallback: string) {
  return profile?.full_name?.trim() || profile?.email?.trim() || fallback;
}

function portalInboxUrl(mosqueSlug: string) {
  return `${getAppBaseUrl()}/m/${mosqueSlug}/portal/announcements`;
}

function teacherInboxUrl(mosqueSlug: string) {
  return `${getAppBaseUrl()}/m/${mosqueSlug}/teacher/inbox`;
}

function renderShell(title: string, body: string, action?: { label: string; href: string }) {
  const actionHtml = action
    ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(action.href)}" style="display:inline-block;background:#2f6f58;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">${escapeHtml(action.label)}</a></p>`
    : "";

  return `
    <div style="margin:0;background:#f7f2e8;padding:28px 16px;font-family:Arial,Helvetica,sans-serif;color:#26323a;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3ded3;border-radius:18px;padding:28px;">
        <p style="margin:0 0 10px;color:#2f6f58;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Tareeqah</p>
        <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#26323a;">${escapeHtml(title)}</h1>
        <div style="font-size:15px;line-height:1.7;color:#52616a;">${body}</div>
        ${actionHtml}
      </div>
    </div>
  `;
}

async function loadEnrollmentEmailContexts(requestIds: string[]) {
  const supabase = createSupabaseServiceClient();
  const { data: requests, error: requestsError } = await supabase.from("enrollment_requests").select("*").in("id", requestIds);

  if (requestsError) {
    throw new Error(requestsError.message);
  }

  const requestRows = requests ?? [];
  if (requestRows.length === 0) {
    return [];
  }

  const programIds = compactIds(requestRows.map((request) => request.program_id));
  const mosqueIds = compactIds(requestRows.map((request) => request.mosque_id));
  const studentIds = compactIds(requestRows.map((request) => request.student_profile_id));
  const parentIds = compactIds(requestRows.map((request) => request.parent_profile_id));

  const [{ data: programs }, { data: mosques }, { data: students }, { data: parents }] = await Promise.all([
    supabase.from("programs").select("*").in("id", programIds),
    supabase.from("mosques").select("*").in("id", mosqueIds),
    studentIds.length ? supabase.from("profiles").select("*").in("id", studentIds) : Promise.resolve({ data: [] as Profile[] }),
    parentIds.length ? supabase.from("profiles").select("*").in("id", parentIds) : Promise.resolve({ data: [] as Profile[] }),
  ]);

  const teacherIds = compactIds((programs ?? []).map((program) => program.teacher_profile_id));
  const { data: teachers } = teacherIds.length
    ? await supabase.from("profiles").select("*").in("id", teacherIds)
    : { data: [] as Profile[] };

  return requestRows
    .map((request): EnrollmentEmailContext | null => {
      const program = (programs ?? []).find((item) => item.id === request.program_id) ?? null;
      const mosque = (mosques ?? []).find((item) => item.id === request.mosque_id) ?? null;
      if (!program || !mosque) {
        return null;
      }

      return {
        request,
        program,
        mosque,
        student: (students ?? []).find((item) => item.id === request.student_profile_id) ?? null,
        parent: request.parent_profile_id ? (parents ?? []).find((item) => item.id === request.parent_profile_id) ?? null : null,
        teacher: program.teacher_profile_id ? (teachers ?? []).find((item) => item.id === program.teacher_profile_id) ?? null : null,
      };
    })
    .filter((context): context is EnrollmentEmailContext => Boolean(context));
}

export async function sendEnrollmentSubmittedEmails(requestIds: string[], userId: string) {
  const contexts = await loadEnrollmentEmailContexts(requestIds);
  const ownedContexts = contexts.filter(({ request }) => request.student_profile_id === userId || request.parent_profile_id === userId);

  const results = await Promise.all(
    ownedContexts.map(async ({ program, mosque, student, parent, teacher }) => {
      if (!teacher?.email) {
        return { ok: true, skipped: true, reason: "Teacher profile has no email." };
      }

      const studentName = profileName(student, "A student");
      const parentName = parent ? profileName(parent, "A parent") : null;
      const requesterText = parentName ? `${parentName} submitted this request for ${studentName}.` : `${studentName} submitted this request.`;
      const body = `
        <p style="margin:0 0 12px;">${escapeHtml(requesterText)}</p>
        <p style="margin:0 0 12px;"><strong>Class:</strong> ${escapeHtml(program.title)}</p>
        <p style="margin:0;">Open your teacher inbox to review the enrollment request.</p>
      `;

      return sendEmail({
        to: teacher.email,
        subject: `New enrollment request for ${program.title}`,
        html: renderShell("New Enrollment Request", body, { label: "Review Request", href: teacherInboxUrl(mosque.slug) }),
        text: `${requesterText}\nClass: ${program.title}\nReview it here: ${teacherInboxUrl(mosque.slug)}`,
        replyTo: parent?.email ?? student?.email ?? null,
      });
    }),
  );

  return { sent: results.filter((result) => !result.skipped).length, skipped: results.filter((result) => result.skipped).length };
}

export async function sendEnrollmentReviewedEmail(requestId: string, reviewerUserId: string) {
  const [context] = await loadEnrollmentEmailContexts([requestId]);
  if (!context) {
    throw new Error("Enrollment request not found.");
  }

  const supabase = createSupabaseServiceClient();
  const { data: canManage, error: canManageError } = await supabase.rpc("can_manage_program", {
    check_program_id: context.program.id,
    check_profile_id: reviewerUserId,
  });

  if (canManageError || !canManage) {
    throw new Error("You cannot send email for this enrollment request.");
  }

  const recipient = context.parent ?? context.student;
  if (!recipient?.email) {
    return { sent: 0, skipped: 1 };
  }

  const studentName = profileName(context.student, "the student");
  const isParentRequest = Boolean(context.parent);
  const className = context.program.title;
  const status = context.request.status;
  const isApproved = status === "approved";
  const isRejected = status === "rejected";
  const isCancelled = status === "cancelled";
  const title = isApproved ? "Enrollment Request Approved" : isRejected ? "Enrollment Request Returned" : isCancelled ? "Enrollment Cancelled" : "Enrollment Request Updated";
  const action = isApproved && context.program.is_paid ? "Complete registration from your inbox to finish joining the class." : "Open your inbox to view the update.";
  const body = `
    <p style="margin:0 0 12px;">${escapeHtml(isParentRequest ? `Your request for ${studentName}` : "Your request")} has been updated.</p>
    <p style="margin:0 0 12px;"><strong>Class:</strong> ${escapeHtml(className)}</p>
    <p style="margin:0 0 12px;"><strong>Status:</strong> ${escapeHtml(status)}</p>
    <p style="margin:0;">${escapeHtml(action)}</p>
  `;

  const result = await sendEmail({
    to: recipient.email,
    subject: `${title}: ${className}`,
    html: renderShell(title, body, { label: isApproved && context.program.is_paid ? "Complete Registration" : "Open Inbox", href: portalInboxUrl(context.mosque.slug) }),
    text: `${title}\nClass: ${className}\nStatus: ${status}\n${action}\n${portalInboxUrl(context.mosque.slug)}`,
  });

  return { sent: result.skipped ? 0 : 1, skipped: result.skipped ? 1 : 0 };
}
