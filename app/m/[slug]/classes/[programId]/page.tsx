import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import {
  getCachedMosqueBySlug,
  getCachedProfile,
  getCachedMembership,
} from "@/lib/supabase/cached-queries";
import {
  getProgramByIdForMosque,
  getEnrollmentForStudent,
  getAnnouncementsForProgram,
  getProgramSubscriptionForStudent,
} from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { canStudentAccessProgram } from "@/lib/billing";
import LeaveProgram from "@/components/LeaveProgram";
import {
  buildCalendarDaysForCurrentMonth,
  formatProgramScheduleSummary,
  formatUpcomingScheduleLine,
  getUpcomingScheduleSessions,
  normalizeProgramSchedule,
  toDateKey,
} from "@/lib/schedule";

type StudentClassPageProps = {
  params: Promise<{
    slug: string;
    programId: string;
  }>;
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

function formatAnnouncementDate(dateValue: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

export default async function StudentClassPage({
  params,
}: StudentClassPageProps) {
  const { slug, programId } = await params;
  const supabase = await createClient();

  const mosque = await getCachedMosqueBySlug(slug);

  if (!mosque) {
    notFound();
  }

  const profile = await getCachedProfile();

  if (!profile) {
    redirect(
      `/m/${slug}/login?next=${encodeURIComponent(`/m/${slug}/classes/${programId}`)}`
    );
  }

  const membership = await getCachedMembership(profile.id, mosque.id);

  if (
    membership?.role === "teacher" ||
    membership?.role === "lead_teacher" ||
    membership?.role === "mosque_admin"
  ) {
    redirect(`/m/${slug}/classes`);
  }

  const program = await getProgramByIdForMosque(programId, mosque.id);

  if (!program) {
    notFound();
  }

  const enrollment = await getEnrollmentForStudent(program.id, profile.id);

  if (!enrollment) {
    redirect(`/m/${slug}/programs/${program.id}`);
  }

  const announcements = await getAnnouncementsForProgram(program.id);

  const subscription = program.is_paid
    ? await getProgramSubscriptionForStudent(profile.id, program.id)
    : null;

  const hasAccess = canStudentAccessProgram({
    program,
    isEnrolled: Boolean(enrollment),
    subscription,
    paymentWaived: Boolean(enrollment?.payment_waived),
  });

  if (!hasAccess) {
    redirect(`/m/${slug}/programs/${program.id}`);
  }

  const schedule = normalizeProgramSchedule(program.schedule);
  const timeZone = program.schedule_timezone || "America/Edmonton";

  const weeklyScheduleText = formatProgramScheduleSummary(schedule, timeZone);

  const upcomingSessions = getUpcomingScheduleSessions(schedule, 3, timeZone);
  const highlightedDateKeys = new Set(
    upcomingSessions.slice(0, 2).map((session) => toDateKey(session.date))
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);

  const { monthLabel, cells } = buildCalendarDaysForCurrentMonth(timeZone);

  return (
    <main className="mx-auto max-w-2xl space-y-4 py-6">
      <Link
        href={`/m/${slug}/classes`}
        className="inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: mosque.primary_color || "#111827" }}
      >
        ← Back to Classes
      </Link>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-gray-500">{mosque.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {program.title}
        </h1>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Schedule</h2>

        <p className="mt-3 text-sm text-gray-600">
          Weekly: {weeklyScheduleText}
        </p>

        {program.schedule_notes ? (
          <p className="mt-2 text-sm text-gray-600">{program.schedule_notes}</p>
        ) : null}

        <div className="mt-4 rounded-2xl border border-gray-200 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">{monthLabel}</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <span>Today</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span>Upcoming class</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <div key={`${label}-${index}`} className="py-1">
                {label}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, index) => {
              if (cell.type === "empty") {
                return (
                  <div
                    key={`empty-${index}`}
                    className="aspect-square rounded-xl"
                  />
                );
              }

              const cellDateKey = toDateKey(cell.date);
              const isToday = cellDateKey === todayKey;
              const isUpcomingClass = highlightedDateKeys.has(cellDateKey);
              const isTodayAndUpcoming = isToday && isUpcomingClass;

              let cellClassName =
                "flex aspect-square items-center justify-center rounded-xl text-sm font-medium";

              let cellStyle: React.CSSProperties | undefined;

              if (isTodayAndUpcoming) {
                cellClassName += " text-white";
                cellStyle = {
                  background:
                    "linear-gradient(135deg, #facc15 0%, #facc15 50%, #22c55e 50%, #22c55e 100%)",
                };
              } else if (isUpcomingClass) {
                cellClassName += " bg-green-500 text-white";
              } else if (isToday) {
                cellClassName += " text-gray-900";
                cellStyle = {
                  backgroundColor: "#facc15",
                };
              } else {
                cellClassName += " text-gray-700";
              }

              return (
                <div key={cellDateKey} className={cellClassName} style={cellStyle}>
                  {cell.date.getDate()}
                </div>
              );
            })}
          </div>
        </div>

        {upcomingSessions.length > 0 ? (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-medium text-gray-900">
              Upcoming Classes
            </h3>

            <div className="space-y-2">
              {upcomingSessions.map((session) => (
                <div
                  key={`${toDateKey(session.date)}-${session.slot.day}-${session.slot.start}`}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                >
                  {formatUpcomingScheduleLine(session, timeZone)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            Schedule information has not been fully set yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Announcements</h2>

        {announcements.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">
            No announcements have been posted for this class yet.
          </p>
        ) : (
          <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
            {announcements.map((announcement) => {
              const author = Array.isArray(announcement.profiles)
                ? announcement.profiles[0]
                : announcement.profiles;

              const authorAvatarSrc = author?.avatar_url
                ? supabase.storage
                    .from("media")
                    .getPublicUrl(author.avatar_url).data.publicUrl
                : DEFAULT_AVATAR;

              return (
                <article
                  key={announcement.id}
                  className="rounded-2xl border border-gray-200 p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                      <Image
                        src={authorAvatarSrc}
                        alt={author?.full_name || "Teacher"}
                        width={40}
                        height={40}
                        className="h-full w-full object-cover"
                        unoptimized={authorAvatarSrc.startsWith("data:")}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium text-gray-900">
                          {author?.full_name || "Teacher"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatAnnouncementDate(announcement.created_at)}
                        </p>
                      </div>

                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                        {announcement.message}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-4 border-t border-gray-200 pt-4">
          <LeaveProgram
            programId={program.id}
            programTitle={program.title}
            mosqueSlug={slug}
          />
        </div>
      </section>
    </main>
  );
}