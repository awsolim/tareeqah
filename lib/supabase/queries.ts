import { createClient } from "@/lib/supabase/server";

// Loads one mosque by its tenant slug
export async function getMosqueBySlug(slug: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosques")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) {
    return null;
  }

  return data;
}

// Loads all active programs for one mosque, including basic teacher details
export async function getProgramsByMosqueId(mosqueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select(`
      id,
      mosque_id,
      teacher_profile_id,
      title,
      description,
      is_active,
      is_paid,
      thumbnail_url,
      price_monthly_cents,
      stripe_product_id,
      stripe_price_id,
      audience_gender,
      age_range_text,
      created_at,
      updated_at,
      teacher:profiles!programs_teacher_profile_id_fkey (
        id,
        full_name,
        avatar_url
      )
    `)
    .eq("mosque_id", mosqueId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load programs: ${error.message}`);
  }

  return (data ?? []).map((program) => {
    const teacher = Array.isArray(program.teacher)
      ? program.teacher[0]
      : program.teacher;

    return {
      id: program.id,
      mosque_id: program.mosque_id,
      teacher_profile_id: program.teacher_profile_id,
      title: program.title,
      description: program.description,
      is_active: program.is_active,
      is_paid: program.is_paid,
      thumbnail_url: program.thumbnail_url,
      price_monthly_cents: program.price_monthly_cents ?? null,
      stripe_product_id: program.stripe_product_id ?? null,
      stripe_price_id: program.stripe_price_id ?? null,
      audience_gender: program.audience_gender ?? null,
      age_range_text: program.age_range_text ?? null,
      created_at: program.created_at,
      updated_at: program.updated_at,
      teacher_name: teacher?.full_name ?? null,
      teacher_avatar_url: teacher?.avatar_url ?? null,
    };
  });
}

export async function getProgramByIdForMosque(
  programId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select(`
      id,
      mosque_id,
      teacher_profile_id,
      title,
      description,
      is_active,
      is_paid,
      thumbnail_url,
      price_monthly_cents,
      stripe_product_id,
      stripe_price_id,
      audience_gender,
      age_range_text,
      schedule,
      schedule_timezone,
      schedule_notes,
      created_at,
      updated_at,
      teacher:profiles!programs_teacher_profile_id_fkey (
        id,
        full_name,
        avatar_url,
        phone_number
      )
    `)
    .eq("id", programId)
    .eq("mosque_id", mosqueId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load program: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const teacher = Array.isArray(data.teacher) ? data.teacher[0] : data.teacher;

  return {
    id: data.id,
    mosque_id: data.mosque_id,
    teacher_profile_id: data.teacher_profile_id,
    title: data.title,
    description: data.description,
    is_active: data.is_active,
    is_paid: data.is_paid,
    thumbnail_url: data.thumbnail_url,
    price_monthly_cents: data.price_monthly_cents ?? null,
    stripe_product_id: data.stripe_product_id ?? null,
    stripe_price_id: data.stripe_price_id ?? null,
    audience_gender: data.audience_gender ?? null,
    age_range_text: data.age_range_text ?? null,
    schedule: Array.isArray(data.schedule) ? data.schedule : [],
    schedule_timezone: data.schedule_timezone ?? "America/Edmonton",
    schedule_notes: data.schedule_notes ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    teacher_name: teacher?.full_name ?? null,
    teacher_avatar_url: teacher?.avatar_url ?? null,
    teacher_phone_number: teacher?.phone_number ?? null,
  };
}

export async function getProfileForCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  return data;
}

export async function getEnrollmentForStudent(
  programId: string,
  studentProfileId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollments")
    .select("*")
    .eq("program_id", programId)
    .eq("student_profile_id", studentProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load enrollment: ${error.message}`);
  }

  return data;
}

export async function getEnrollmentsForStudentInMosque(
  studentProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollments")
    .select(`
      id,
      program_id,
      programs (
        id,
        mosque_id,
        title,
        description,
        is_active,
        schedule,
        schedule_timezone
      )
    `)
    .eq("student_profile_id", studentProfileId)
    .eq("programs.mosque_id", mosqueId);

  if (error) {
    throw new Error(`Failed to load enrollments: ${error.message}`);
  }

  return (data ?? []).map((enrollment) => {
    const rawProgram = Array.isArray(enrollment.programs)
      ? enrollment.programs[0]
      : enrollment.programs;

    return {
      id: enrollment.id,
      program_id: enrollment.program_id,
      programs: rawProgram
        ? {
            id: rawProgram.id,
            mosque_id: rawProgram.mosque_id,
            title: rawProgram.title,
            description: rawProgram.description,
            is_active: rawProgram.is_active,
            schedule: Array.isArray(rawProgram.schedule) ? rawProgram.schedule : [],
            schedule_timezone:
              rawProgram.schedule_timezone ?? "America/Edmonton",
          }
        : null,
    };
  });
}

export async function getMosqueMembershipForUser(
  profileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosque_memberships")
    .select("*")
    .eq("profile_id", profileId)
    .eq("mosque_id", mosqueId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mosque membership: ${error.message}`);
  }

  return data;
}

export async function getProgramsByMosqueIdIncludingInactive(mosqueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("mosque_id", mosqueId)
    .order("title", { ascending: true });

  if (error) {
    throw new Error(`Failed to load admin programs: ${error.message}`);
  }

  return data ?? [];
}

export async function getProgramByIdIncludingInactiveForMosque(
  programId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("mosque_id", mosqueId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load admin program: ${error.message}`);
  }

  return data;
}

export async function getProgramsForTeacherInMosque(
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select(`
      id,
      mosque_id,
      teacher_profile_id,
      title,
      description,
      is_active,
      schedule,
      schedule_timezone
    `)
    .eq("mosque_id", mosqueId)
    .eq("teacher_profile_id", teacherProfileId)
    .order("title", { ascending: true });

  if (error) {
    throw new Error(`Failed to load teacher programs: ${error.message}`);
  }

  return (data ?? []).map((program) => ({
    ...program,
    schedule: Array.isArray(program.schedule) ? program.schedule : [],
    schedule_timezone: program.schedule_timezone ?? "America/Edmonton",
  }));
}

export async function getTeachersForMosque(mosqueId: string) {
  const supabase = await createClient();

  const { data: memberships, error: membershipsError } = await supabase
    .from("mosque_memberships")
    .select("id, mosque_id, profile_id, role")
    .eq("mosque_id", mosqueId)
    .in("role", ["teacher", "lead_teacher"]);

  if (membershipsError) {
    throw new Error(`Failed to load teacher memberships: ${membershipsError.message}`);
  }

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const profileIds = [...new Set(memberships.map((membership) => membership.profile_id))];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds);

  if (profilesError) {
    throw new Error(`Failed to load teacher profiles: ${profilesError.message}`);
  }

  const teachers = profileIds.map((profileId) => {
    const profile = profiles?.find((item) => item.id === profileId);

    return {
      profile_id: profileId,
      full_name: profile?.full_name ?? null,
    };
  });

  return teachers;
}

export async function getEnrollmentsForTeacherProgramsInMosque(
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollments")
    .select(`
      id,
      created_at,
      student_profile_id,
      profiles!enrollments_student_profile_id_fkey (
        id,
        full_name
      ),
      programs!inner (
        id,
        mosque_id,
        title,
        teacher_profile_id
      )
    `)
    .eq("programs.mosque_id", mosqueId)
    .eq("programs.teacher_profile_id", teacherProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load teacher enrollments: ${error.message}`);
  }

  return data ?? [];
}

export async function getTeacherProgramByIdInMosque(
  programId: string,
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("mosque_id", mosqueId)
    .eq("teacher_profile_id", teacherProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load teacher program: ${error.message}`);
  }

  return data;
}

export async function getEnrollmentsForProgramInTeacherView(
  programId: string,
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollments")
    .select(`
      id,
      created_at,
      student_profile_id,
      profiles!enrollments_student_profile_id_fkey (
        id,
        full_name
      ),
      programs!inner (
        id,
        mosque_id,
        teacher_profile_id,
        title
      )
    `)
    .eq("program_id", programId)
    .eq("programs.id", programId)
    .eq("programs.mosque_id", mosqueId)
    .eq("programs.teacher_profile_id", teacherProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load teacher roster: ${error.message}`);
  }

  return data ?? [];
}

export async function getProfileById(profileId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  return data;
}

export async function getEnrollmentsForProgramInAdminView(
  programId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollments")
    .select(`
      id,
      created_at,
      student_profile_id,
      payment_waived,
      waived_by,
      waived_at,
      profiles!enrollments_student_profile_id_fkey (
        id,
        full_name
      ),
      programs!inner (
        id,
        mosque_id,
        title
      )
    `)
    .eq("program_id", programId)
    .eq("programs.id", programId)
    .eq("programs.mosque_id", mosqueId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load admin enrollments: ${error.message}`);
  }

  // Fetch waiver approver names for waived enrollments
  const waivedByIds = (data ?? [])
    .filter((e) => e.payment_waived && e.waived_by)
    .map((e) => e.waived_by as string);

  const uniqueWaivedByIds = [...new Set(waivedByIds)];

  let waiverApprovers: Record<string, string> = {};

  if (uniqueWaivedByIds.length > 0) {
    const { data: approverProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uniqueWaivedByIds);

    if (approverProfiles) {
      waiverApprovers = Object.fromEntries(
        approverProfiles.map((p) => [p.id, p.full_name ?? "Unknown"])
      );
    }
  }

  return (data ?? []).map((enrollment) => ({
    ...enrollment,
    waiver_approver_name: enrollment.waived_by
      ? waiverApprovers[enrollment.waived_by] ?? null
      : null,
  }));
}

export async function getAdminProgramCardsByMosqueId(mosqueId: string) {
  const supabase = await createClient();

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select(`
      id,
      mosque_id,
      teacher_profile_id,
      title,
      description,
      is_active,
      is_paid,
      price_monthly_cents,
      created_at,
      updated_at,
      teacher:profiles!programs_teacher_profile_id_fkey (
        id,
        full_name
      ),
      enrollments (
        id
      )
    `)
    .eq("mosque_id", mosqueId)
    .order("title", { ascending: true });

  if (programsError) {
    throw new Error(`Failed to load admin program cards: ${programsError.message}`);
  }

  return (programs ?? []).map((program) => {
    const teacher = Array.isArray(program.teacher)
      ? program.teacher[0]
      : program.teacher;
    const enrollmentCount = Array.isArray(program.enrollments)
      ? program.enrollments.length
      : 0;

    return {
      ...program,
      teacher: undefined,
      enrollments: undefined,
      teacher_name: teacher?.full_name?.trim() || null,
      enrolled_student_count: enrollmentCount,
    };
  });
}

export async function getTeacherDashboardStats(
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select("id")
    .eq("mosque_id", mosqueId)
    .eq("teacher_profile_id", teacherProfileId);

  if (programsError) {
    throw new Error(`Failed to load teacher dashboard programs: ${programsError.message}`);
  }

  const safePrograms = programs ?? [];
  const classCount = safePrograms.length;

  if (classCount === 0) {
    return {
      class_count: 0,
      student_count: 0,
    };
  }

  const programIds = safePrograms.map((program) => program.id);

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select("id")
    .in("program_id", programIds);

  if (enrollmentsError) {
    throw new Error(`Failed to load teacher dashboard enrollments: ${enrollmentsError.message}`);
  }

  return {
    class_count: classCount,
    student_count: (enrollments ?? []).length,
  };
}

export async function getAdminDashboardStats(mosqueId: string) {
  const supabase = await createClient();

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .select("id, is_active")
    .eq("mosque_id", mosqueId);

  if (programsError) {
    throw new Error(`Failed to load admin dashboard programs: ${programsError.message}`);
  }

  const safePrograms = programs ?? [];
  const totalPrograms = safePrograms.length;
  const activePrograms = safePrograms.filter((program) => program.is_active).length;

  const { data: teacherMemberships, error: teacherMembershipsError } = await supabase
    .from("mosque_memberships")
    .select("id")
    .eq("mosque_id", mosqueId)
    .in("role", ["teacher", "lead_teacher"]);

  if (teacherMembershipsError) {
    throw new Error(`Failed to load admin dashboard teachers: ${teacherMembershipsError.message}`);
  }

  const programIds = safePrograms.map((program) => program.id);

  const { data: enrollments, error: enrollmentsError } =
    programIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("enrollments")
          .select("id")
          .in("program_id", programIds);

  if (enrollmentsError) {
    throw new Error(`Failed to load admin dashboard enrollments: ${enrollmentsError.message}`);
  }

  return {
    total_program_count: totalPrograms,
    active_program_count: activePrograms,
    teacher_count: (teacherMemberships ?? []).length,
    student_count: (enrollments ?? []).length,
  };
}

export async function getAnnouncementsForProgram(programId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_announcements")
    .select(`
      id,
      program_id,
      author_profile_id,
      message,
      created_at,
      profiles!program_announcements_author_profile_id_fkey (
        id,
        full_name,
        avatar_url
      )
    `)
    .eq("program_id", programId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load announcements: ${error.message}`);
  }

  return data ?? [];
}

export async function getTeacherAnnouncementAuthorProfile(profileId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load announcement author profile: ${error.message}`);
  }

  return data;
}

export async function getAllMosques() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosques")
    .select("id, name, slug, logo_url")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load mosques: ${error.message}`);
  }

  return data ?? [];
}

export async function getLatestAnnouncementsForPrograms(programIds: string[]) {
  const supabase = await createClient();

  if (programIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("program_announcements")
    .select(`
      id,
      program_id,
      author_profile_id,
      message,
      created_at,
      profiles!program_announcements_author_profile_id_fkey (
        id,
        full_name,
        avatar_url
      )
    `)
    .in("program_id", programIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load latest announcements: ${error.message}`);
  }

  const latestByProgramId = new Map<string, (typeof data)[number]>();

  for (const announcement of data ?? []) {
    if (!latestByProgramId.has(announcement.program_id)) {
      latestByProgramId.set(announcement.program_id, announcement);
    }
  }

  return Array.from(latestByProgramId.values());
}

export async function getProgramSubscriptionForStudent(
  profileId: string,
  programId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_subscriptions")
    .select("*")
    .eq("profile_id", profileId)
    .eq("program_id", programId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load program subscription: ${error.message}`);
  }

  return data;
}

export async function hasActiveProgramSubscription(
  profileId: string,
  programId: string
) {
  const subscription = await getProgramSubscriptionForStudent(profileId, programId);
  return subscription?.status === "active";
}

export async function getProgramApplicationForStudent(
  profileId: string,
  programId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_applications")
    .select("*")
    .eq("student_profile_id", profileId)
    .eq("program_id", programId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load program application: ${error.message}`);
  }

  return data;
}

export async function getStudentProgramApplicationsInMosque(
  profileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_applications")
    .select(`
      id,
      status,
      created_at,
      reviewed_at,
      joined_at,
      program_id,
      programs!inner (
        id,
        mosque_id,
        title,
        is_paid
      )
    `)
    .eq("student_profile_id", profileId)
    .eq("programs.mosque_id", mosqueId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load student applications: ${error.message}`);
  }

  return data ?? [];
}

export async function getMosqueMembers(mosqueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosque_memberships")
    .select(`
      id,
      mosque_id,
      profile_id,
      role,
      can_manage_programs,
      created_at,
      profiles!mosque_memberships_profile_id_fkey (
        full_name,
        email,
        avatar_url
      )
    `)
    .eq("mosque_id", mosqueId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load mosque members: ${error.message}`);
  }

  return (data ?? []).map((member) => {
    const profile = Array.isArray(member.profiles)
      ? member.profiles[0]
      : member.profiles;

    return {
      id: member.id,
      mosque_id: member.mosque_id,
      profile_id: member.profile_id,
      role: member.role,
      can_manage_programs: member.can_manage_programs,
      created_at: member.created_at,
      profile: {
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        avatar_url: profile?.avatar_url ?? null,
      },
    };
  });
}

export async function getMosqueTeachers(mosqueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosque_memberships")
    .select(`
      id,
      mosque_id,
      profile_id,
      role,
      can_manage_programs,
      created_at,
      profiles!mosque_memberships_profile_id_fkey (
        full_name,
        email,
        avatar_url
      )
    `)
    .eq("mosque_id", mosqueId)
    .in("role", ["teacher", "lead_teacher"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load mosque teachers: ${error.message}`);
  }

  return (data ?? []).map((member) => {
    const profile = Array.isArray(member.profiles)
      ? member.profiles[0]
      : member.profiles;

    return {
      id: member.id,
      mosque_id: member.mosque_id,
      profile_id: member.profile_id,
      role: member.role,
      can_manage_programs: member.can_manage_programs,
      created_at: member.created_at,
      profile: {
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        avatar_url: profile?.avatar_url ?? null,
      },
    };
  });
}

export async function getTeacherProgramApplicationsInMosque(
  teacherProfileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_applications")
    .select(`
      id,
      status,
      created_at,
      reviewed_at,
      joined_at,
      student_profile_id,
      programs!inner (
        id,
        mosque_id,
        title,
        teacher_profile_id,
        is_paid
      ),
      profiles!program_applications_student_profile_id_fkey (
        id,
        full_name,
        email,
        phone_number,
        gender,
        age
      )
    `)
    .eq("programs.mosque_id", mosqueId)
    .eq("programs.teacher_profile_id", teacherProfileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load teacher applications: ${error.message}`);
  }

  return data ?? [];
}

export async function getApplicationsForProgramInAdminView(
  programId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("program_applications")
    .select(`
      id,
      status,
      created_at,
      reviewed_at,
      joined_at,
      student_profile_id,
      programs!inner (
        id,
        mosque_id,
        title,
        is_paid
      ),
      profiles!program_applications_student_profile_id_fkey (
        id,
        full_name,
        email
      )
    `)
    .eq("program_id", programId)
    .eq("programs.mosque_id", mosqueId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load admin program applications: ${error.message}`);
  }

  return data ?? [];
}

export async function getActiveTagsForMosque(mosqueId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("programs")
    .select("tags")
    .eq("mosque_id", mosqueId)
    .eq("is_active", true);

  if (!data) return [];
  const allTags = data.flatMap((p: any) => p.tags || []);
  return [...new Set(allTags)].sort();
}

export async function getChildrenForParent(parentProfileId: string, mosqueId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parent_child_links")
    .select(`
      id,
      child_profile_id,
      created_at,
      profiles!parent_child_links_child_profile_id_fkey (
        id, full_name, date_of_birth, gender, avatar_url
      )
    `)
    .eq("parent_profile_id", parentProfileId)
    .eq("mosque_id", mosqueId);

  return data || [];
}

export async function getChildEnrollments(childProfileId: string, mosqueId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(`
      id,
      created_at,
      programs (
        id, title, description, thumbnail_url, schedule, schedule_timezone,
        mosque_id,
        teacher_profile_id,
        profiles!programs_teacher_profile_id_fkey ( full_name, avatar_url )
      )
    `)
    .eq("student_profile_id", childProfileId);

  // PostgREST does not reliably filter parent rows via foreign table dot-notation.
  // Filter in JS instead, following the pattern in getEnrollmentsForStudentInMosque.
  return (data || []).filter((e: any) => e.programs?.mosque_id === mosqueId);
}

export async function getChildApplications(childProfileId: string, mosqueId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("program_applications")
    .select(`
      id,
      status,
      created_at,
      programs (
        id, title, description, thumbnail_url, mosque_id
      )
    `)
    .eq("student_profile_id", childProfileId)
    .order("created_at", { ascending: false });

  // Filter by mosque in JS — same PostgREST limitation as above.
  return (data || []).filter((a: any) => a.programs?.mosque_id === mosqueId);
}

export async function getChildEnrollmentsBatch(childProfileIds: string[], mosqueId: string) {
  if (childProfileIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(`
      id,
      student_profile_id,
      created_at,
      programs (
        id, title, description, thumbnail_url, schedule, schedule_timezone,
        mosque_id,
        teacher_profile_id,
        profiles!programs_teacher_profile_id_fkey ( full_name, avatar_url )
      )
    `)
    .in("student_profile_id", childProfileIds);

  return (data || []).filter((e: any) => e.programs?.mosque_id === mosqueId);
}

export async function getChildApplicationsBatch(childProfileIds: string[], mosqueId: string) {
  if (childProfileIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("program_applications")
    .select(`
      id,
      status,
      student_profile_id,
      created_at,
      programs (
        id, title, description, thumbnail_url, mosque_id
      )
    `)
    .in("student_profile_id", childProfileIds)
    .order("created_at", { ascending: false });

  return (data || []).filter((a: any) => a.programs?.mosque_id === mosqueId);
}

export async function verifyParentChildLink(
  parentProfileId: string,
  childProfileId: string,
  mosqueId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parent_child_links")
    .select("id")
    .eq("parent_profile_id", parentProfileId)
    .eq("child_profile_id", childProfileId)
    .eq("mosque_id", mosqueId)
    .single();

  return !!data;
}

/**
 * Get pending teacher join requests for a mosque.
 */
export async function getPendingTeacherRequests(mosqueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("teacher_join_requests")
    .select(`
      id,
      mosque_id,
      profile_id,
      status,
      created_at,
      profiles!teacher_join_requests_profile_id_fkey (
        id,
        full_name,
        email
      )
    `)
    .eq("mosque_id", mosqueId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []).map((request) => {
    const profile = Array.isArray(request.profiles)
      ? request.profiles[0]
      : request.profiles;

    return {
      id: request.id,
      mosque_id: request.mosque_id,
      profile_id: request.profile_id,
      status: request.status,
      created_at: request.created_at,
      profile: profile ?? null,
    };
  });
}

/**
 * Get the teacher join request for a specific user and mosque.
 */
export async function getTeacherRequestForUser(
  profileId: string,
  mosqueId: string
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("teacher_join_requests")
    .select("id, status")
    .eq("profile_id", profileId)
    .eq("mosque_id", mosqueId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data;
}

/**
 * Get all teacher join requests for a user across all mosques.
 */
export async function getTeacherRequestsForUser(profileId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("teacher_join_requests")
    .select("mosque_id, status")
    .eq("profile_id", profileId);

  if (error) {
    return [];
  }

  return data ?? [];
}

/**
 * Get all mosque memberships for a given user (across all mosques).
 */
export async function getMembershipsForUser(profileId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mosque_memberships")
    .select("mosque_id")
    .eq("profile_id", profileId);

  if (error) {
    return [];
  }

  return data ?? [];
}