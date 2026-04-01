import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getCachedMosqueBySlug,
  getCachedProfile,
  getCachedMembership,
} from "@/lib/supabase/cached-queries";
import {
  getProgramByIdIncludingInactiveForMosque,
  getEnrollmentsForProgramInAdminView,
  getApplicationsForProgramInAdminView,
  getProfileById,
} from "@/lib/supabase/queries";
import { revokeWaiver, waivePayment } from "@/app/actions/waivers";
import {
  acceptProgramApplication,
  rejectProgramApplication,
} from "@/app/actions/applications";

type AdminProgramDetailPageProps = {
  params: Promise<{
    slug: string;
    programId: string;
  }>;
};

export default async function AdminProgramDetailPage({
  params,
}: AdminProgramDetailPageProps) {
  const { slug, programId } = await params; // Read the tenant slug and program id so the page stays mosque-scoped.

  const mosque = await getCachedMosqueBySlug(slug); // Load the mosque for this tenant slug.

  if (!mosque) {
    notFound(); // Hide invalid mosque slugs behind a normal 404.
  }

  const profile = await getCachedProfile(); // Load the signed-in profile for admin authorization.

  if (!profile) {
    redirect(
      `/m/${slug}/login?next=${encodeURIComponent(`/m/${slug}/admin/programs/${programId}`)}`
    ); // Require login before allowing access to admin program detail.
  }

  const membership = await getCachedMembership(profile.id, mosque.id); // Load the user's mosque-scoped role.

  const isMosqueAdmin = membership?.role === "mosque_admin";
const isTeacher = membership?.role === "teacher";
const canManagePrograms =
  isMosqueAdmin || (isTeacher && membership?.can_manage_programs);

if (!canManagePrograms) {
  notFound();
}

  const program = await getProgramByIdIncludingInactiveForMosque(
    programId,
    mosque.id
  ); // Load the program only if it belongs to this mosque.

  if (!program) {
    notFound(); // Hide invalid or cross-tenant program ids.
  }

  const [enrollments, applications] = await Promise.all([
    getEnrollmentsForProgramInAdminView(program.id, mosque.id),
    getApplicationsForProgramInAdminView(program.id, mosque.id),
  ]);

  const teacherProfile = program.teacher_profile_id
    ? await getProfileById(program.teacher_profile_id)
    : null; // Load the assigned teacher's profile name when the program has a teacher.

  const teacherName =
    teacherProfile?.full_name?.trim() || null; // Use the teacher's readable name when available.

  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <Link
          href={`/m/${slug}/admin/programs`}
          className="mt-1 text-lg font-medium text-gray-500"
          aria-label="Back to Manage Programs"
        >
          ←
        </Link>

        <div>
          <p className="text-sm text-gray-500">{mosque.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{program.title}</h1>
          <p className="text-sm text-gray-600">Admin view for this program.</p>
        </div>
      </div>

      <Link
        href={`/m/${slug}/admin/programs/${program.id}/edit`}
        className="block cursor-pointer rounded-2xl border border-gray-200 p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md active:scale-[0.98]"
      >
        <article>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Program Details</h2>

              {program.description ? (
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {program.description}
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  No description yet.
                </p>
              )}

              <div className="mt-4 space-y-1 text-sm text-gray-600">
                <p>
                  Assigned Teacher:{" "}
                  <span className="font-medium text-black">
                    {teacherName || "Unassigned"}
                  </span>
                </p>
              </div>
            </div>

            <div className="ml-3 flex items-start gap-3">
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  program.is_active
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {program.is_active ? "Active" : "Inactive"}
              </span>

              <span className="text-lg text-gray-400">›</span>
            </div>
          </div>
        </article>
      </Link>

      {applications.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Applications</h2>
            <p className="mt-1 text-sm text-gray-600">
              Student applications for this program.
            </p>
          </div>

          <div className="space-y-3">
            {applications.map((application) => {
              const student = Array.isArray(application.profiles)
                ? application.profiles[0]
                : application.profiles;

              const appProgram = Array.isArray(application.programs)
                ? application.programs[0]
                : application.programs;

              return (
                <article
                  key={application.id}
                  className="rounded-2xl border border-gray-200 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {student?.full_name || "Student"}
                      </h3>
                      {student?.email ? (
                        <p className="mt-0.5 text-xs text-gray-500">{student.email}</p>
                      ) : null}
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
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

                  {application.status === "pending" ? (
                    <div className="mt-3 flex gap-3">
                      <form action={acceptProgramApplication} className="flex-1">
                        <input type="hidden" name="slug" value={slug} />
                        <input
                          type="hidden"
                          name="applicationId"
                          value={application.id}
                        />
                        <button
                          type="submit"
                          className="w-full rounded-xl bg-green-600 px-4 py-2.5 text-sm font-medium text-white"
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
                          className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  ) : null}

                  {application.status === "accepted" && appProgram?.is_paid ? (
                    <div className="mt-3">
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
                          value={appProgram.id}
                        />
                        <button
                          type="submit"
                          className="w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white"
                        >
                          Waive Payment
                        </button>
                      </form>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Enrolled Students</h2>
          <p className="mt-1 text-sm text-gray-600">
            Students currently registered in this program.
          </p>
        </div>

        {enrollments.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 p-4 shadow-sm">
            <p className="text-sm text-gray-600">
              No students are enrolled in this program yet.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {enrollments.map((enrollment) => {
              const student = Array.isArray(enrollment.profiles)
                ? enrollment.profiles[0]
                : enrollment.profiles;

              return (
                <article
                  key={enrollment.id}
                  className="rounded-2xl border border-gray-200 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold">
                        {student?.full_name?.trim() ||
                          `Student ${enrollment.student_profile_id.slice(0, 8)}`}
                      </h3>

                      <p className="mt-2 text-sm text-gray-600">
                        Registered for this program.
                      </p>
                    </div>

                    {enrollment.payment_waived ? (
                      <span
                        className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700"
                        title={
                          enrollment.waiver_approver_name
                            ? `Waived by ${enrollment.waiver_approver_name}`
                            : "Payment waived"
                        }
                      >
                        Waived
                      </span>
                    ) : null}
                  </div>

                  {enrollment.payment_waived && enrollment.waiver_approver_name ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Payment waived by {enrollment.waiver_approver_name}
                    </p>
                  ) : null}

                  {enrollment.payment_waived && isMosqueAdmin ? (
                    <form action={revokeWaiver} className="mt-3">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="programId" value={program.id} />
                      <input
                        type="hidden"
                        name="studentProfileId"
                        value={enrollment.student_profile_id}
                      />
                      <button
                        type="submit"
                        className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Revoke Waiver
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}