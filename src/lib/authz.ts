import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type MosqueRole = "admin" | "teacher" | "parent" | "student";

export type UserAccess = {
  profileId: string | null;
  accountType: string | null;
  mosqueRoles: MosqueRole[];
  isMosqueAdmin: boolean;
  isTeacher: boolean;
  isStudent: boolean;
  isParent: boolean;
};

export const emptyUserAccess: UserAccess = {
  profileId: null,
  accountType: null,
  mosqueRoles: [],
  isMosqueAdmin: false,
  isTeacher: false,
  isStudent: false,
  isParent: false,
};

export async function loadUserAccessByMosqueSlug(slug: string): Promise<UserAccess> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user.id) {
    return emptyUserAccess;
  }

  const [{ data: mosque }, { data: profile }] = await Promise.all([
    supabase.from("mosques").select("id").eq("slug", slug).maybeSingle(),
    supabase.from("profiles").select("id, account_type").eq("id", session.user.id).maybeSingle(),
  ]);

  const accountType = profile?.account_type ?? readMetadataAccountType(session.user.user_metadata);

  const membershipRows = mosque?.id
    ? await supabase.from("mosque_memberships").select("role").eq("mosque_id", mosque.id).eq("profile_id", session.user.id).eq("status", "active")
    : { data: [] };

  const mosqueRoles = (membershipRows.data ?? []).map((row) => row.role).filter(isMosqueRole);
  const allMosqueRoles = Array.from(new Set(mosqueRoles));
  const normalizedAccountType = accountType?.toLowerCase() ?? null;
  const useProfileAccountType = normalizedAccountType === "admin" || normalizedAccountType === "teacher" || normalizedAccountType === "parent" || normalizedAccountType === "student";

  return {
    profileId: session.user.id,
    accountType,
    mosqueRoles: allMosqueRoles,
    isMosqueAdmin: useProfileAccountType ? normalizedAccountType === "admin" : allMosqueRoles.includes("admin"),
    isTeacher: useProfileAccountType ? normalizedAccountType === "teacher" : allMosqueRoles.includes("teacher"),
    isStudent: useProfileAccountType ? normalizedAccountType === "student" : allMosqueRoles.includes("student"),
    isParent: useProfileAccountType ? normalizedAccountType === "parent" : allMosqueRoles.includes("parent"),
  };
}

export function getDefaultLandingHref(slug: string, access: UserAccess) {
  const accountType = access.accountType?.toLowerCase() ?? null;

  if (accountType === "student" || accountType === "parent") {
    return `/m/${slug}/portal`;
  }

  if (accountType === "admin" || access.isMosqueAdmin) {
    return `/m/${slug}/admin`;
  }

  if (accountType === "teacher" || access.isTeacher) {
    return `/m/${slug}/teacher`;
  }

  return `/m/${slug}/portal`;
}

export function getAccountLabel(access: UserAccess) {
  if (!access.profileId) {
    return "Not signed in";
  }

  const accountType = access.accountType?.toLowerCase() ?? null;

  if (accountType === "parent") {
    return "Parent Account";
  }

  if (accountType === "student") {
    return "Student Account";
  }

  if (accountType === "admin" || access.isMosqueAdmin) {
    return "Admin Account";
  }

  if (accountType === "teacher" || access.isTeacher) {
    return "Teacher Account";
  }

  if (access.isParent) {
    return "Parent Account";
  }

  if (access.isStudent) {
    return "Student Account";
  }

  return "Account";
}

function readMetadataAccountType(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("account_type" in metadata)) {
    return null;
  }

  const accountType = metadata.account_type;
  return typeof accountType === "string" ? accountType : null;
}

function isMosqueRole(role: string): role is MosqueRole {
  return role === "admin" || role === "teacher" || role === "parent" || role === "student";
}
