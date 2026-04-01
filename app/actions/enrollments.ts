"use server";

import { notFound, redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { isAdminOrTeacher } from "@/lib/permissions";

export async function enrollInProgram(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const programId = String(formData.get("programId") ?? "").trim();
  const nextPath = `/m/${slug}/programs/${programId}`;

  if (!slug || !programId) {
    redirect("/");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/m/${slug}/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("Could not load student profile.");
  }

  const { data: mosque, error: mosqueError } = await supabase
    .from("mosques")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (mosqueError || !mosque) {
    notFound();
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, mosque_id, is_active")
    .eq("id", programId)
    .eq("mosque_id", mosque.id)
    .eq("is_active", true)
    .maybeSingle();

  if (programError || !program) {
    throw new Error("Program not found.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("mosque_memberships")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("mosque_id", mosque.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Could not verify mosque role: ${membershipError.message}`);
  }

  const isTeacher = membership?.role === "teacher";
  const isMosqueAdmin = membership?.role === "mosque_admin";
  const isParent = membership?.role === "parent";

  if (isTeacher || isMosqueAdmin || isParent) {
    throw new Error("Only student accounts can enroll in programs.");
  }

  const { data: existingEnrollment, error: existingError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("program_id", programId)
    .eq("student_profile_id", profile.id)
    .maybeSingle();

  if (existingError) {
    throw new Error("Could not check enrollment status.");
  }

  if (!existingEnrollment) {
    const { error: insertError } = await supabase.from("enrollments").insert({
      program_id: programId,
      student_profile_id: profile.id,
    });

    if (insertError) {
      throw new Error(`Failed to enroll: ${insertError.message}`);
    }
  }

  revalidateTag("enrollments", "max");
  revalidateTag("mosque-programs", "max");

  redirect(nextPath);
}

export async function withdrawFromProgram(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const programId = String(formData.get("programId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();

  const fallbackPath = `/m/${slug}/programs/${programId}`;
  const nextPath = returnTo || fallbackPath;

  if (!slug || !programId) {
    redirect("/");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/m/${slug}/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("Could not load student profile.");
  }

  const { data: existingEnrollment, error: existingError } = await supabase
    .from("enrollments")
    .select("id")
    .eq("program_id", programId)
    .eq("student_profile_id", profile.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Could not check current enrollment: ${existingError.message}`);
  }

  if (!existingEnrollment) {
    revalidateTag("enrollments", "max");
    revalidateTag("mosque-programs", "max");
    redirect(nextPath);
  }

  // Cancel any active Stripe subscription for this student/program
  const { data: activeSub } = await supabase
    .from("program_subscriptions")
    .select("id, stripe_subscription_id, status")
    .eq("profile_id", profile.id)
    .eq("program_id", programId)
    .eq("status", "active")
    .maybeSingle();

  if (activeSub?.stripe_subscription_id) {
    await stripe.subscriptions.cancel(activeSub.stripe_subscription_id);

    await supabase
      .from("program_subscriptions")
      .update({
        status: "canceled",
        ended_at: new Date().toISOString(),
      })
      .eq("id", activeSub.id);
  }

  const { error: deleteError } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", existingEnrollment.id);

  if (deleteError) {
    throw new Error(`Failed to withdraw: ${deleteError.message}`);
  }

  // Reset application status so the student can re-apply or get another waiver
  await supabase
    .from("program_applications")
    .update({ status: "accepted" })
    .eq("program_id", programId)
    .eq("student_profile_id", profile.id)
    .eq("status", "joined");

  revalidateTag("enrollments", "max");
  revalidateTag("applications", "max");
  revalidateTag("mosque-programs", "max");

  redirect(nextPath);
}

export async function removeStudentFromProgram(
  programId: string,
  studentProfileId: string
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: "Could not load current profile." };
  }

  // Look up the program to get the mosque_id and teacher
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, mosque_id, teacher_profile_id")
    .eq("id", programId)
    .maybeSingle();

  if (programError || !program) {
    return { error: "Program not found." };
  }

  // Verify caller is teacher of this program or mosque admin
  const { data: membership, error: membershipError } = await supabase
    .from("mosque_memberships")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("mosque_id", program.mosque_id)
    .maybeSingle();

  if (membershipError) {
    return { error: `Could not verify membership: ${membershipError.message}` };
  }

  if (!isAdminOrTeacher(membership?.role)) {
    return { error: "You do not have permission to remove students from this program." };
  }

  // Check if this was a waived enrollment (affects application reset status)
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, payment_waived")
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId)
    .maybeSingle();

  // Cancel any active Stripe subscription for this student/program
  const { data: activeSub } = await supabase
    .from("program_subscriptions")
    .select("id, stripe_subscription_id, status")
    .eq("profile_id", studentProfileId)
    .eq("program_id", programId)
    .eq("status", "active")
    .maybeSingle();

  if (activeSub?.stripe_subscription_id) {
    await stripe.subscriptions.cancel(activeSub.stripe_subscription_id);

    await supabase
      .from("program_subscriptions")
      .update({
        status: "canceled",
        ended_at: new Date().toISOString(),
      })
      .eq("id", activeSub.id);
  }

  // Delete the enrollment
  const { error: deleteError } = await supabase
    .from("enrollments")
    .delete()
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId);

  if (deleteError) {
    return { error: `Failed to remove student: ${deleteError.message}` };
  }

  // Waived students reset to "accepted" so admin can re-waive or student can pay.
  // Paid/free students reset to "rejected" to require re-application.
  const resetStatus = enrollment?.payment_waived ? "accepted" : "rejected";
  await supabase
    .from("program_applications")
    .update({ status: resetStatus })
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId);

  revalidateTag("enrollments", "max");
  revalidateTag("applications", "max");
  revalidateTag("mosque-programs", "max");

  return { success: true };
}