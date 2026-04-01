"use server";


import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getMosqueBySlug } from "@/lib/supabase/queries";

export async function signup(formData: FormData) {
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const slug = String(formData.get("slug") || "").trim();
  const role = String(formData.get("role") || "student").trim();

  if (!fullName || !email || !password || !slug) {
    redirect("/");
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    redirect(`/m/${slug}/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (data.user?.id) {
    // Use service client for profile creation — the user's session may not be
    // established yet if email confirmation is enabled, so RLS would block the insert.
    const serviceClient = createServiceClient();
    const { error: profileError } = await serviceClient.from("profiles").upsert({
      id: data.user.id,
      full_name: fullName,
      email,
    });

    if (profileError) {
      redirect(`/m/${slug}/signup?error=${encodeURIComponent(profileError.message)}`);
    }

    const mosque = await getMosqueBySlug(slug);
    if (mosque) {
      const memberRole = role === "parent" ? "parent" : "student";
      await supabase.from("mosque_memberships").upsert({
        mosque_id: mosque.id,
        profile_id: data.user.id,
        role: memberRole,
      }, { onConflict: "mosque_id,profile_id" });

      // Teacher signup: create a join request pending admin approval
      if (role === "teacher") {
        await supabase.from("teacher_join_requests").insert({
          mosque_id: mosque.id,
          profile_id: data.user.id,
          status: "pending",
        });
      }
    }
  }

  redirect(`/m/${slug}/dashboard`);
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") || "").trim(); // Read the email from the form.
  const password = String(formData.get("password") || ""); // Read the password from the form.
  const slug = String(formData.get("slug") || "").trim(); // Read the tenant slug from the form.

  if (!email || !password || !slug) {
    redirect("/"); // Reject incomplete login submissions.
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/m/${slug}/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/m/${slug}/dashboard`);
}

export async function assignRole(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim();
  const mosqueId = String(formData.get("mosqueId") || "").trim();
  const role = String(formData.get("role") || "student").trim();

  if (!slug || !mosqueId) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/m/${slug}/login`);
  }

  const memberRole = role === "parent" ? "parent" : "student";
  await supabase.from("mosque_memberships").upsert(
    {
      mosque_id: mosqueId,
      profile_id: user.id,
      role: memberRole,
    },
    { onConflict: "mosque_id,profile_id" },
  );

  if (role === "teacher") {
    await supabase.from("teacher_join_requests").insert({
      mosque_id: mosqueId,
      profile_id: user.id,
      status: "pending",
    });
  }

  redirect(`/m/${slug}/dashboard`);
}

/**
 * Completes an OAuth signup by updating the profile name (if changed),
 * creating a mosque membership with the selected role, and optionally
 * creating a teacher join request.
 */
export async function completeOAuthSignup(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim();
  const mosqueId = String(formData.get("mosqueId") || "").trim();
  const fullName = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "student").trim();

  if (!slug || !mosqueId || !fullName) {
    redirect(`/m/${slug || ""}/complete-signup`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/m/${slug}/login`);
  }

  // Update profile name (user may have edited the Google-provided name)
  await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id);

  // Create membership
  const memberRole = role === "parent" ? "parent" : "student";
  await supabase.from("mosque_memberships").upsert(
    {
      mosque_id: mosqueId,
      profile_id: user.id,
      role: memberRole,
    },
    { onConflict: "mosque_id,profile_id" },
  );

  // Teacher signup: create a join request pending admin approval
  if (role === "teacher") {
    await supabase.from("teacher_join_requests").insert({
      mosque_id: mosqueId,
      profile_id: user.id,
      status: "pending",
    });
  }

  redirect(`/m/${slug}/dashboard`);
}

export async function logout(formData: FormData) {
  const slug = String(formData.get("slug") || "").trim(); // Read the tenant slug so logout can return to the correct portal.
  const supabase = await createClient();

  await supabase.auth.signOut();

  if (!slug) {
    redirect("/");
  }

  redirect(`/m/${slug}/`);
}
