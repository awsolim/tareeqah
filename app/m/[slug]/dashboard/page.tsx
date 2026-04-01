import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  getCachedMosqueBySlug,
  getCachedProfile,
  getCachedMembership,
} from "@/lib/supabase/cached-queries";
import {
  getEnrollmentsForStudentInMosque,
  getTeacherDashboardStats,
  getAdminDashboardStats,
  getLatestAnnouncementsForPrograms,
  getProgramsForTeacherInMosque,
  getStudentProgramApplicationsInMosque,
  getTeacherProgramApplicationsInMosque,
} from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import StudentEnrollmentCard from "@/components/dashboard/StudentEnrollmentCard";
import TeacherProgramCard from "@/components/dashboard/TeacherProgramCard";
import { ParentDashboard } from "@/components/dashboard/ParentDashboard";
import {
  acceptProgramApplication,
  rejectProgramApplication,
  joinApprovedFreeProgram,
} from "@/app/actions/applications";
import { waivePayment } from "@/app/actions/waivers";

type PageProps = {
  params: Promise<{ slug: string }>;
};

const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect width="200" height="200" rx="100" fill="#e5e7eb" />
      <circle cx="100" cy="78" r="34" fill="#9ca3af" />
      <path d="M45 165c10-30 36-46 55-46s45 16 55 46" fill="#9ca3af" />
    </svg>
  `);

export default async function DashboardPage({ params }: PageProps) {
  const { slug } = await params;

  const mosque = await getCachedMosqueBySlug(slug);
  const primaryColor = "var(--primary-color)";
  const secondaryColor = "var(--secondary-color)";

  if (!mosque) {
    notFound();
  }

  const profile = await getCachedProfile();

  if (!profile) {
    redirect(`/m/${slug}/login?next=${encodeURIComponent(`/m/${slug}/dashboard`)}`);
  }

  const membership = await getCachedMembership(profile.id, mosque.id);

  if (membership?.role === "parent") {
    return (
      <ParentDashboard
        profileId={profile.id}
        mosqueId={mosque.id}
        slug={slug}
        primaryColor={primaryColor}
      />
    );
  }

  const isMosqueAdmin = membership?.role === "mosque_admin";
  const isLeadTeacher = membership?.role === "lead_teacher";
  const isTeacher = membership?.role === "teacher";
  const isTeacherLike = isTeacher || isLeadTeacher;
  const canManagePrograms =
    isMosqueAdmin || isLeadTeacher || (isTeacher && membership?.can_manage_programs);
  const isStudentOnly = !isMosqueAdmin && !isTeacherLike;

  const [enrollments, teachingPrograms, studentApplications, teacherApplications, teacherStats, adminStats] =
    await Promise.all([
      isStudentOnly ? getEnrollmentsForStudentInMosque(profile.id, mosque.id) : Promise.resolve([]),
      isTeacherLike ? getProgramsForTeacherInMosque(profile.id, mosque.id) : Promise.resolve([]),
      isStudentOnly ? getStudentProgramApplicationsInMosque(profile.id, mosque.id) : Promise.resolve([]),
      isTeacherLike ? getTeacherProgramApplicationsInMosque(profile.id, mosque.id) : Promise.resolve([]),
      isTeacherLike ? getTeacherDashboardStats(profile.id, mosque.id) : Promise.resolve(null),
      canManagePrograms ? getAdminDashboardStats(mosque.id) : Promise.resolve(null),
    ]);

  const enrolledProgramIds = enrollments
    .map((enrollment) => {
      const program = Array.isArray(enrollment.programs)
        ? enrollment.programs[0]
        : enrollment.programs;

      return program?.id ?? null;
    })
    .filter((programId): programId is string => Boolean(programId));

  const teachingProgramIds = teachingPrograms
    .map((program) => program.id)
    .filter((programId): programId is string => Boolean(programId));

  const relevantProgramIds = isStudentOnly
    ? enrolledProgramIds
    : isTeacherLike
    ? teachingProgramIds
    : [];

  const latestAnnouncements =
    isStudentOnly || isTeacherLike
      ? await getLatestAnnouncementsForPrograms(relevantProgramIds)
      : [];

  const supabase = await createClient();

  const latestAnnouncementByProgramId = new Map(
    latestAnnouncements.map((announcement) => {
      const author = Array.isArray(announcement.profiles)
        ? announcement.profiles[0]
        : announcement.profiles;

      const authorAvatarSrc = author?.avatar_url
        ? supabase.storage.from("media").getPublicUrl(author.avatar_url).data.publicUrl
        : DEFAULT_AVATAR;

      return [
        announcement.program_id,
        {
          id: announcement.id,
          message: announcement.message,
          created_at: announcement.created_at,
          author_name: author?.full_name ?? null,
          author_avatar_src: authorAvatarSrc,
        },
      ];
    })
  );

  return (
    <main className="mx-auto max-w-4xl py-6">
      <div className="space-y-1">
        <p className="text-sm text-gray-500">{mosque.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-gray-600">
          Your activity and classes in this mosque.
        </p>
      </div>

      {canManagePrograms ? (
        <section className="mt-6 rounded-2xl border border-gray-200 p-4 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Management</h2>
            <p className="text-sm text-gray-600">
              Manage programs and mosque content.
            </p>
          </div>

          {adminStats ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-sm text-gray-500">Programs</p>
                <p className="mt-1 text-xl font-semibold">
                  {adminStats.total_program_count}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-sm text-gray-500">Active</p>
                <p className="mt-1 text-xl font-semibold">
                  {adminStats.active_program_count}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-sm text-gray-500">Teachers</p>
                <p className="mt-1 text-xl font-semibold">
                  {adminStats.teacher_count}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-sm text-gray-500">Students</p>
                <p className="mt-1 text-xl font-semibold">
                  {adminStats.student_count}
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <Link
              href={`/m/${slug}/admin/programs`}
              className="block rounded-xl px-4 py-3 text-center text-sm font-medium text-white"
              style={{ backgroundColor: primaryColor }}
            >
              Manage Programs
            </Link>
          </div>

          {isMosqueAdmin ? (
            <Link
              href={`/m/${slug}/admin/teacher-requests`}
              className="mt-3 block rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-medium"
            >
              Teacher Requests
            </Link>
          ) : null}
        </section>
      ) : null}

      {isTeacherLike ? (
        <>
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pending Applications</h2>
            </div>

            {teacherApplications.length === 0 ? (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-600">
                  No pending applications
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {teacherApplications.map((application) => {
                  const student = Array.isArray(application.profiles)
                    ? application.profiles[0]
                    : application.profiles;

                  const program = Array.isArray(application.programs)
                    ? application.programs[0]
                    : application.programs;

                  if (!program) return null;

                  return (
                    <details
                      key={application.id}
                      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-gray-900">
                              {student?.full_name || "Student"}
                            </h3>
                            <p className="mt-1 text-sm text-gray-600">
                              Applied to {program.title}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                application.status === "pending"
                                  ? "bg-amber-100 text-amber-700"
                                  : application.status === "accepted"
                                  ? "bg-green-100 text-green-700"
                                  : application.status === "rejected"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {application.status}
                            </span>

                            <span className="text-sm text-gray-400">›</span>
                          </div>
                        </div>
                      </summary>

                      <div className="mt-4 space-y-2 border-t border-gray-200 pt-4 text-sm text-gray-700">
                        <p>
                          <span className="font-medium text-black">Name:</span>{" "}
                          {student?.full_name || "Unknown"}
                        </p>
                        <p>
                          <span className="font-medium text-black">Email:</span>{" "}
                          {student?.email || "Not provided"}
                        </p>
                        <p>
                          <span className="font-medium text-black">Phone:</span>{" "}
                          {student?.phone_number || "Not provided"}
                        </p>
                        <p>
                          <span className="font-medium text-black">Gender:</span>{" "}
                          {student?.gender === "male"
                            ? "Brother"
                            : student?.gender === "female"
                            ? "Sister"
                            : "Not provided"}
                        </p>
                        <p>
                          <span className="font-medium text-black">Age:</span>{" "}
                          {student?.age ?? "Not provided"}
                        </p>

                        {application.status === "pending" ? (
                          <div className="mt-4 flex gap-3">
                            <form action={acceptProgramApplication} className="flex-1">
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="applicationId"
                                value={application.id}
                              />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-medium text-white"
                              >
                                Accept
                              </button>
                            </form>

                            <form action={rejectProgramApplication} className="flex-1">
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="applicationId"
                                value={application.id}
                              />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white"
                              >
                                Reject
                              </button>
                            </form>
                          </div>
                        ) : null}

                        {application.status === "accepted" && program.is_paid ? (
                          <div className="mt-4">
                            <form action={waivePayment}>
                              <input type="hidden" name="slug" value={slug} />
                              <input
                                type="hidden"
                                name="applicationId"
                                value={application.id}
                              />
                              <input
                                type="hidden"
                                name="studentProfileId"
                                value={application.student_profile_id}
                              />
                              <input
                                type="hidden"
                                name="programId"
                                value={program.id}
                              />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-medium text-white"
                              >
                                Waive Payment
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">My Classes</h2>
            </div>

            {teachingPrograms.length === 0 ? (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-600">
                  You are not assigned to teach any classes.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {teachingPrograms.map((program) => (
                  <TeacherProgramCard
                    key={program.id}
                    slug={slug}
                    program={{
                      id: program.id,
                      title: program.title,
                      description: program.description ?? null,
                      schedule: program.schedule ?? [],
                      schedule_timezone: program.schedule_timezone ?? "America/Edmonton",
                    }}
                    latestAnnouncement={
                      latestAnnouncementByProgramId.get(program.id) ?? null
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-gray-200 p-4 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Teacher</h2>
              <p className="text-sm text-gray-600">
                View the classes assigned to you and the students in them.
              </p>
            </div>

            {teacherStats ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 p-3">
                  <p className="text-sm text-gray-500">Classes</p>
                  <p className="mt-1 text-xl font-semibold">
                    {teacherStats.class_count}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3">
                  <p className="text-sm text-gray-500">Students</p>
                  <p className="mt-1 text-xl font-semibold">
                    {teacherStats.student_count}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/m/${slug}/classes`}
                className="block flex-1 rounded-xl px-4 py-3 text-center text-sm font-medium text-white"
                style={{ backgroundColor: primaryColor }}
              >
                My Classes
              </Link>

              <Link
                href={`/m/${slug}/students`}
                className="block flex-1 rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-medium text-white"
                style={{ backgroundColor: secondaryColor }}
              >
                View Students
              </Link>
            </div>
          </section>
        </>
      ) : null}

      {isStudentOnly ? (
        <>
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Inbox</h2>
            </div>

            {studentApplications.length === 0 ? (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-600">
                  No notifications.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {studentApplications.map((application) => {
                  const program = Array.isArray(application.programs)
                    ? application.programs[0]
                    : application.programs;

                  if (!program) return null;

                  return (
                    <div
                      key={application.id}
                      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-gray-900">
                            {program.title}
                          </h3>
                          <p className="mt-1 text-sm text-gray-600">
                            {application.status === "pending"
                              ? "Your application is waiting for teacher review."
                              : application.status === "rejected"
                              ? "Your application was not approved."
                              : application.status === "accepted" && !program.is_paid
                              ? "You were accepted. You can now join this class."
                              : application.status === "accepted" && program.is_paid
                              ? "You were accepted. Complete payment and join class."
                              : application.status === "joined"
                              ? "You have joined this class."
                              : "Application update"}
                          </p>
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            application.status === "pending"
                              ? "bg-amber-100 text-amber-700"
                              : application.status === "accepted"
                              ? "bg-green-100 text-green-700"
                              : application.status === "rejected"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {application.status}
                        </span>
                      </div>

                      {application.status === "accepted" && !program.is_paid ? (
                        <form action={joinApprovedFreeProgram} className="mt-4">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="programId" value={program.id} />
                          <button
                            type="submit"
                            className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white"
                            style={{ backgroundColor: primaryColor }}
                          >
                            Join Class
                          </button>
                        </form>
                      ) : null}

                      {application.status === "accepted" && program.is_paid ? (
                        <div className="mt-4 space-y-3">
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-800">
                            Stripe checkout is not connected yet.
                          </div>

                          <Link
                            href={`/m/${slug}/programs/${program.id}`}
                            className="block rounded-xl px-4 py-3 text-center text-sm font-medium text-white"
                            style={{ backgroundColor: primaryColor }}
                          >
                            Complete Payment and Join Class
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">My Enrollments</h2>
            </div>

            {enrollments.length === 0 ? (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-600">
                  You are not enrolled in any programs.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {enrollments.map((enrollment) => {
                  const program = Array.isArray(enrollment.programs)
                    ? enrollment.programs[0]
                    : enrollment.programs;

                  if (!program) return null;

                  return (
                    <StudentEnrollmentCard
                      key={enrollment.id}
                      slug={slug}
                      program={{
                        id: program.id,
                        title: program.title,
                        description: program.description ?? null,
                        schedule: program.schedule ?? [],
                        schedule_timezone:
                          program.schedule_timezone ?? "America/Edmonton",
                      }}
                      latestAnnouncement={
                        latestAnnouncementByProgramId.get(program.id) ?? null
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/m/${slug}/classes`}
              className="block flex-1 rounded-xl px-4 py-3 text-center text-sm font-medium text-white"
              style={{ backgroundColor: primaryColor }}
            >
              Go to My Classes
            </Link>

            <Link
              href={`/m/${slug}/programs`}
              className="block flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium"
            >
              Explore More Programs
            </Link>
          </section>
        </>
      ) : null}
    </main>
  );
}