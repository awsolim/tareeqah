import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type MosqueRole = "admin" | "teacher" | "parent" | "student";

export type UserAccess = {
  profileId: string | null;
  accountType: string | null;
  mosqueRoles: MosqueRole[];
  teacherApprovalStatus: string | null;
  isMosqueAdmin: boolean;
  isTeacher: boolean;
  isStudent: boolean;
  isParent: boolean;
};

export const emptyUserAccess: UserAccess = {
  profileId: null,
  accountType: null,
  mosqueRoles: [],
  teacherApprovalStatus: null,
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
    ? await supabase
        .from("mosque_memberships")
        .select("role, status, teacher_approval_status")
        .eq("mosque_id", mosque.id)
        .eq("profile_id", session.user.id)
    : { data: [] };

  const activeVerifiedRows = (membershipRows.data ?? []).filter((row) => row.status === "active");
  const mosqueRoles = activeVerifiedRows.map((row) => row.role).filter(isMosqueRole);
  const allMosqueRoles = Array.from(new Set(mosqueRoles));
  const teacherApprovalStatus =
    (membershipRows.data ?? []).find((row) => row.role === "teacher")?.teacher_approval_status ?? null;
  const normalizedAccountType = accountType?.toLowerCase() ?? null;

  return {
    profileId: session.user.id,
    accountType,
    mosqueRoles: allMosqueRoles,
    teacherApprovalStatus,
    isMosqueAdmin: normalizedAccountType === "admin" && allMosqueRoles.includes("admin"),
    isTeacher: normalizedAccountType === "teacher" && allMosqueRoles.includes("teacher"),
    isStudent: normalizedAccountType === "student" && allMosqueRoles.includes("student"),
    isParent: normalizedAccountType === "parent" && allMosqueRoles.includes("parent"),
  };
}

export function getDefaultLandingHref(slug: string, access: UserAccess) {
  const accountType = access.accountType?.toLowerCase() ?? null;

  if (accountType === "student" || accountType === "parent") {
    return `/m/${slug}/portal`;
  }

  if (access.isMosqueAdmin) {
    return `/m/${slug}/admin`;
  }

  if (access.isTeacher) {
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

  if (access.isMosqueAdmin) {
    return "Admin Account";
  }

  if (access.isTeacher) {
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
