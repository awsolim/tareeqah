"use server";

import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdminOrTeacher, isAdmin } from "@/lib/permissions";

export async function waivePayment(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const studentProfileId = String(formData.get("studentProfileId") ?? "").trim();
  const programId = String(formData.get("programId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();

  if (!slug || !applicationId || !studentProfileId || !programId) {
    redirect("/");
  }

  const redirectPath = returnTo || `/m/${slug}/dashboard`;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/m/${slug}/login?next=${encodeURIComponent(`/m/${slug}/dashboard`)}`
    );
  }

  // Verify caller is admin or teacher with can_manage_programs
  const { data: mosque, error: mosqueError } = await supabase
    .from("mosques")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (mosqueError || !mosque) {
    throw new Error("Mosque not found.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("mosque_memberships")
    .select("role, can_manage_programs")
    .eq("profile_id", user.id)
    .eq("mosque_id", mosque.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      `Could not verify membership: ${membershipError.message}`
    );
  }

  if (!isAdminOrTeacher(membership?.role)) {
    throw new Error("You do not have permission to waive payments.");
  }

  // Non-admin roles (teacher, lead_teacher) need can_manage_programs to waive
  if (
    membership?.role !== "mosque_admin" &&
    !membership?.can_manage_programs
  ) {
    throw new Error("You do not have permission to waive payments.");
  }

  // Verify application exists and is accepted
  const { data: application, error: applicationError } = await supabase
    .from("program_applications")
    .select("id, status, program_id, student_profile_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError || !application) {
    throw new Error("Application not found.");
  }

  if (application.status !== "accepted") {
    throw new Error("Can only waive payment for accepted applications.");
  }

  if (application.student_profile_id !== studentProfileId) {
    throw new Error("Application does not match student.");
  }

  if (application.program_id !== programId) {
    throw new Error("Application does not match program.");
  }

  // Verify program is paid
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, is_paid, mosque_id")
    .eq("id", programId)
    .eq("mosque_id", mosque.id)
    .maybeSingle();

  if (programError || !program) {
    throw new Error("Program not found.");
  }

  if (!program.is_paid) {
    throw new Error("Cannot waive payment for a free program.");
  }

  // Check if student is already enrolled (idempotent)
  const { data: existingEnrollment, error: existingError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Could not check enrollment: ${existingError.message}`
    );
  }

  if (existingEnrollment) {
    // Student is already enrolled — nothing to do
    revalidateTag("enrollments", "max");
    revalidateTag("applications", "max");
    revalidateTag("mosque-programs", "max");
    redirect(`/m/${slug}/dashboard`);
  }

  // Create enrollment with waiver fields
  const { error: insertError } = await supabase.from("enrollments").insert({
    program_id: programId,
    student_profile_id: studentProfileId,
    payment_waived: true,
    waived_by: user.id,
    waived_at: new Date().toISOString(),
  });

  if (insertError) {
    throw new Error(`Failed to enroll student: ${insertError.message}`);
  }

  // Update application status to joined
  const { error: updateError } = await supabase
    .from("program_applications")
    .update({
      status: "joined",
      joined_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  if (updateError) {
    throw new Error(
      `Failed to update application status: ${updateError.message}`
    );
  }

  revalidateTag("enrollments", "max");
  revalidateTag("applications", "max");
  revalidateTag("mosque-programs", "max");

  redirect(`/m/${slug}/dashboard`);
}

export async function revokeWaiver(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const programId = String(formData.get("programId") ?? "").trim();
  const studentProfileId = String(formData.get("studentProfileId") ?? "").trim();

  if (!slug || !programId || !studentProfileId) {
    redirect("/");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/m/${slug}/login?next=${encodeURIComponent(`/m/${slug}/dashboard`)}`
    );
  }

  // Only mosque admins can revoke waivers
  const { data: mosque, error: mosqueError } = await supabase
    .from("mosques")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (mosqueError || !mosque) {
    throw new Error("Mosque not found.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("mosque_memberships")
    .select("role")
    .eq("profile_id", user.id)
    .eq("mosque_id", mosque.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      `Could not verify membership: ${membershipError.message}`
    );
  }

  if (!isAdmin(membership?.role)) {
    throw new Error("Only mosque admins can revoke payment waivers.");
  }

  // Find the waived enrollment
  const { data: enrollment, error: enrollmentError } = await supabase
    .from("enrollments")
    .select("id, payment_waived")
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId)
    .maybeSingle();

  if (enrollmentError) {
    throw new Error(
      `Could not find enrollment: ${enrollmentError.message}`
    );
  }

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }

  if (!enrollment.payment_waived) {
    throw new Error("This enrollment was not waived.");
  }

  // Delete the enrollment
  const { error: deleteError } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollment.id);

  if (deleteError) {
    throw new Error(`Failed to remove enrollment: ${deleteError.message}`);
  }

  // Reset application status to accepted
  await supabase
    .from("program_applications")
    .update({ status: "accepted" })
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId);

  revalidateTag("enrollments", "max");
  revalidateTag("applications", "max");
  revalidateTag("mosque-programs", "max");

  redirect(`/m/${slug}/admin/programs/${programId}`);
}
