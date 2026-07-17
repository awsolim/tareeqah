import Link from "next/link";
import { AuthPanel } from "@/components/auth/auth-panel";
import { GoogleAuthCallback } from "@/components/auth/google-auth-callback";
import { OAuthProfileCompletion } from "@/components/auth/oauth-profile-completion";
import { ForgotPasswordPanel, ResetPasswordPanel } from "@/components/auth/password-reset";
import { PortalRoleRedirect } from "@/components/data/portal-role-redirect";
import { AdminClassesData, AdminHomeData, AdminMasjidData, AdminMasjidFinancesData, AdminMasjidInformationData, AdminMembersData, InboxAnnouncementsData, MosqueDirectoryRows, PortalAccountData, ProgramDetailData, ProgramFinancesData, PublicMasjidData, PublicProgramsData, StudentClassesData, StudentHomeData, StudentScheduleOptionsData, StudentWithdrawalRequestData, TeacherAnnouncementData, TeacherClassesData, TeacherHomeData, TeacherInboxData, TeacherInstructorsData, TeacherProgramCreateData, TeacherProgramSettingsData, TeacherScheduleData, TeacherStudentNotesData, TeacherStudentsData } from "@/components/data/supabase-public-sections";
import { ActionToolbar } from "@/components/ui/action-toolbar";
import { DataRow } from "@/components/ui/data-row";
import { DataTable } from "@/components/ui/data-table";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FlatButton, FlatLink } from "@/components/ui/flat-button";
import { FormField, SelectField, TextareaField } from "@/components/ui/form-field";
import { StatusPill } from "@/components/ui/status-pill";
import { PageShell } from "@/components/layout/page-shell";
import { PageTitleBar } from "@/components/layout/page-title-bar";
import {
  attendanceRecords,
  className,
  classes,
  currentUser,
  enrollments,
  family,
  getClass,
  masjid,
  programs,
  sessions,
  studentName,
} from "@/lib/mock-data";
import type { Program } from "@/lib/mock-data";
import { cn, formatDate, formatTime } from "@/lib/utils";

function Workspace({
  children,
  overlap = true,
  overlapOffset = "-172px",
  surfaceClassName = "bg-[var(--workspace)]",
}: {
  children: React.ReactNode;
  overlap?: boolean;
  overlapOffset?: string;
  surfaceClassName?: string;
}) {
  return (
    <div
      className={cn("relative z-10 min-h-[calc(100vh-260px)]", overlap ? "" : `${surfaceClassName} py-8`)}
      style={overlap ? { marginTop: overlapOffset } : undefined}
    >
      <div
        className={cn(overlap ? "min-h-[calc(100vh-260px)] overflow-hidden rounded-t-[34px]" : "", surfaceClassName)}
      >
        {children}
      </div>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`bg-white ${className}`}>{children}</section>;
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between border-b border-[#D6DCE0] bg-white px-4">
      <h2 className="text-base font-medium text-[#26323A]">{title}</h2>
      {action}
    </div>
  );
}

function ProgramThumb({ program }: { program: Program }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center bg-[#E7F3F8] text-sm font-medium text-[#2F8FB3]">
      {program.name
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)}
    </div>
  );
}

function ProgramRows({ limit, grouped = false, slug }: { limit?: number; grouped?: boolean; slug: string }) {
  const visiblePrograms = limit ? programs.slice(0, limit) : programs;
  const groups = grouped
    ? Array.from(new Set(visiblePrograms.map((program) => program.day))).map((day) => ({
        day,
        items: visiblePrograms.filter((program) => program.day === day),
      }))
    : [{ day: "", items: visiblePrograms }];

  return (
    <div>
      {groups.map((group) => (
        <Panel key={group.day || "all"} className="border-b border-[#D6DCE0] last:border-b-0">
          {group.day ? <SectionHeader title={group.day} /> : null}
          {group.items.map((program) => (
            <DataRow
              key={program.id}
              leading={<ProgramThumb program={program} />}
              title={<Link href={`/m/${slug}/programs/${program.id}`}>{program.name}</Link>}
              subtitle={`${program.ageRange} - ${program.description}`}
              status={<StatusPill status={program.status} />}
              meta={[
                { label: "Schedule", value: `${program.day}, ${program.time}` },
                { label: "Teacher", value: classes.find((classSection) => classSection.programId === program.id)?.teacher ?? "TBA" },
                { label: "Tuition", value: program.tuition },
              ]}
              action={<FlatLink href={`/m/${slug}/programs/${program.id}`} variant="toolbar">View</FlatLink>}
            />
          ))}
        </Panel>
      ))}
    </div>
  );
}

function ScheduleRows({ limit }: { limit?: number }) {
  const visibleSessions = limit ? sessions.slice(0, limit) : sessions;
  return (
    <Panel>
      {visibleSessions.map((session) => {
        const section = getClass(session.classId);
        return (
          <DataRow
            key={session.id}
            title={className(session.classId)}
            subtitle={session.topic}
            meta={[
              { label: "Date", value: formatDate(session.date) },
              { label: "Time", value: `${formatTime(section.startTime)}-${formatTime(section.endTime)}` },
              { label: "Room", value: section.room },
            ]}
          />
        );
      })}
    </Panel>
  );
}

function AuthForm({ mode, slug }: { mode: "login" | "signup"; slug: string }) {
  return (
    <main className="min-h-screen bg-white">
      <PageTitleBar title={mode === "login" ? "Log In" : "Create Account"} subtitle={masjid.name} tone="teal" />
      <Workspace>
        <Panel>
          <AuthPanel mode={mode} slug={slug} />
        </Panel>
      </Workspace>
    </main>
  );
}

export function RootHomePage() {
  return (
    <main className="min-h-screen bg-[var(--workspace)]">
      <div className="border-b border-[#D6DCE0] bg-white">
        <div className="app-container py-8">
          <p className="text-sm font-medium uppercase tracking-wide text-[#6B747B]">Tareeqah</p>
          <h1 className="mt-1 text-3xl font-normal text-[#26323A]">Masjid Directory</h1>
        </div>
      </div>
      <Workspace overlap={false}>
        <Panel>
          <MosqueDirectoryRows />
        </Panel>
      </Workspace>
    </main>
  );
}

export function PublicMasjidPage({ slug }: { slug: string }) {
  return (
    <PageShell slug={slug}>
      <PageTitleBar title="Home" subtitle="Registration, schedules, and family class updates." />
      <Workspace>
        <PublicMasjidData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function PublicProgramsPage({ slug }: { slug: string }) {
  return (
    <PageShell slug={slug}>
      <PageTitleBar title="Programs" subtitle="Find weekly classes, workshops, and circles." tone="teal" />
      <Workspace>
        <PublicProgramsData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function PublicAccountPage({ slug }: { slug: string }) {
  return (
    <PageShell slug={slug}>
      <PortalAccountData slug={slug} />
    </PageShell>
  );
}

export function PublicProgramDetailPage({ programId, slug, returnTo }: { programId: string; slug: string; returnTo?: string }) {
  const backLabel = returnTo?.includes("/admin/programs") || returnTo?.includes("/teacher/classes") || returnTo?.includes("/portal/classes") ? "Classes" : "Programs";
  return (
    <PageShell slug={slug}>
      <PageTitleBar title="Class Details" backHref={returnTo ?? `/m/${slug}/programs`} backLabel={backLabel} tone="teal" />
      <Workspace>
        <ProgramDetailData slug={slug} programId={programId} section="public" />
      </Workspace>
    </PageShell>
  );
}

export function PortalProgramDetailPage({ programId, slug }: { programId: string; slug: string }) {
  return (
    <>
      <PageTitleBar title="Class Details" backHref={`/m/${slug}/portal/classes`} backLabel="Classes" tone="teal" />
      <Workspace>
        <ProgramDetailData slug={slug} programId={programId} section="portal" />
      </Workspace>
    </>
  );
}

export function TeacherProgramDetailPage({ programId, slug }: { programId: string; slug: string }) {
  return (
    <>
      <PageTitleBar title="Edit Program" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" tone="teal" />
      <Workspace>
        <TeacherProgramSettingsData slug={slug} programId={programId} />
      </Workspace>
    </>
  );
}

export function TeacherProgramCreatePage({ slug }: { slug: string }) {
  return (
    <>
      <PageTitleBar title="Add Class" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" tone="teal" />
      <Workspace>
        <TeacherProgramCreateData slug={slug} />
      </Workspace>
    </>
  );
}

export function TeacherInstructorsPage({ programId, slug }: { programId: string; slug: string }) {
  return (
    <>
      <PageTitleBar title="Instructors" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" tone="teal" centerBackTitle smallTitle />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <TeacherInstructorsData slug={slug} programId={programId} />
      </Workspace>
    </>
  );
}

export function LoginPage({ slug }: { slug: string }) {
  return <AuthForm mode="login" slug={slug} />;
}

export function SignupPage({ slug }: { slug: string }) {
  return <AuthForm mode="signup" slug={slug} />;
}

export function ForgotPasswordPage({ slug }: { slug: string }) {
  return (
    <main className="min-h-screen bg-white">
      <PageTitleBar title="Reset Password" subtitle={masjid.name} tone="teal" />
      <Workspace>
        <Panel>
          <ForgotPasswordPanel slug={slug} />
        </Panel>
      </Workspace>
    </main>
  );
}

export function ResetPasswordPage({ slug }: { slug: string }) {
  return (
    <main className="min-h-screen bg-white">
      <PageTitleBar title="New Password" subtitle={masjid.name} tone="teal" />
      <Workspace>
        <Panel>
          <ResetPasswordPanel slug={slug} />
        </Panel>
      </Workspace>
    </main>
  );
}

export function GoogleAuthCallbackPage({ slug }: { slug: string }) {
  return (
    <PageShell slug={slug}>
      <PageTitleBar title="Signing in" subtitle={masjid.name} tone="teal" />
      <Workspace>
        <Panel>
          <GoogleAuthCallback slug={slug} />
        </Panel>
      </Workspace>
    </PageShell>
  );
}

export function CompleteOAuthProfilePage({ slug }: { slug: string }) {
  return (
    <main className="min-h-screen bg-white">
      <PageTitleBar title="Profile" subtitle="Finish your account setup." tone="teal" />
      <Workspace>
        <Panel>
          <OAuthProfileCompletion slug={slug} />
        </Panel>
      </Workspace>
    </main>
  );
}

export function PortalDashboardPage({ slug }: { slug: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher`} adminHref={`/m/${slug}/admin`}>
      <PageTitleBar title="Home" />
      <Workspace>
        <StudentHomeData slug={slug} />
      </Workspace>
    </PortalRoleRedirect>
  );
}

export function PortalAccountPage({ slug }: { slug: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher/account`} adminHref={`/m/${slug}/admin/settings`}>
      <PortalAccountData slug={slug} />
    </PortalRoleRedirect>
  );
}

export function PortalFamilyPage({ slug }: { slug: string }) {
  void slug;
  return (
    <>
      <PageTitleBar title="My Family" subtitle="Students connected to this family account." />
      <Workspace>
        <Panel>
          <SectionHeader title="Students" action={<FlatButton variant="primary">Add Student</FlatButton>} />
          {family.students.map((student) => (
            <DataRow key={student.id} title={student.name} subtitle={student.grade} meta={[{ label: "Age", value: student.age }, { label: "Student ID", value: student.id }]} />
          ))}
        </Panel>
      </Workspace>
    </>
  );
}

export function PortalClassesPage({ slug }: { slug: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher/classes`} adminHref={`/m/${slug}/admin/programs`}>
      <PageTitleBar title="Classes" tone="teal" />
      <Workspace>
        <StudentClassesData slug={slug} />
      </Workspace>
    </PortalRoleRedirect>
  );
}

export function PortalScheduleOptionsPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher/classes`} adminHref={`/m/${slug}/admin/programs`}>
      <PageTitleBar title="Schedule Options" backHref={`/m/${slug}/portal/classes`} backLabel="Classes" tone="teal" />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <StudentScheduleOptionsData slug={slug} programId={programId} />
      </Workspace>
    </PortalRoleRedirect>
  );
}

export function PortalWithdrawalRequestPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher/classes`} adminHref={`/m/${slug}/admin/programs`}>
      <PageTitleBar title="Withdrawal" backHref={`/m/${slug}/portal/classes`} backLabel="Classes" tone="teal" />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <StudentWithdrawalRequestData slug={slug} programId={programId} />
      </Workspace>
    </PortalRoleRedirect>
  );
}

export function PortalSchedulePage({ slug }: { slug: string }) {
  void slug;
  return (
    <>
      <PageTitleBar title="Schedule" subtitle="Upcoming family sessions." />
      <Workspace>
        <ScheduleRows />
      </Workspace>
    </>
  );
}

function EmptyAttendanceState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#22A6B3] text-3xl font-medium text-[#22A6B3]">!</div>
      <h3 className="mt-4 text-base font-medium text-[#26323A]">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-[#6B747B]">{text}</p>
    </div>
  );
}

export function PortalAttendancePage({ slug }: { slug: string }) {
  void slug;
  return (
    <>
      <PageTitleBar title="Attendance" subtitle="Review attendance and submit planned absences." tone="teal" />
      <Workspace>
        <Panel className="border-b border-[#D6DCE0] p-4">
          <p className="text-sm leading-6 text-[#26323A]">Use this area to review recent attendance and notify the office before a student misses class.</p>
          <div className="mt-4">
            <FlatButton variant="success">Submit an Absence</FlatButton>
          </div>
        </Panel>
        <Panel>
          <SectionHeader title="Upcoming" />
          <EmptyAttendanceState title="No upcoming absences" text="Submitted absences for upcoming classes will appear here." />
        </Panel>
        <Panel>
          <SectionHeader title="Past" />
          {attendanceRecords.length ? (
            attendanceRecords.map((record) => (
              <DataRow
                key={record.id}
                title={studentName(record.studentId)}
                subtitle={className(sessions.find((session) => session.id === record.sessionId)?.classId ?? "")}
                status={<StatusPill status={record.status} />}
              />
            ))
          ) : (
            <EmptyAttendanceState title="No attendance records" text="Past attendance records will appear here after class." />
          )}
        </Panel>
      </Workspace>
    </>
  );
}

export function PortalAnnouncementsPage({ slug }: { slug: string }) {
  return (
    <PortalRoleRedirect slug={slug} teacherHref={`/m/${slug}/teacher/inbox`} adminHref={`/m/${slug}/admin/enrollments`}>
      <PageTitleBar title="Inbox" />
      <Workspace>
        <Panel>
          <InboxAnnouncementsData slug={slug} />
        </Panel>
      </Workspace>
    </PortalRoleRedirect>
  );
}

export function TeacherDashboardPage({ slug }: { slug: string }) {
  return (
    <>
      <PageTitleBar title="Home" tone="teal" />
      <Workspace>
        <TeacherHomeData slug={slug} />
      </Workspace>
    </>
  );
}

export function TeacherClassesPage({ slug }: { slug: string }) {
  return (
    <>
      <PageTitleBar title="Classes" />
      <Workspace>
        <TeacherClassesData slug={slug} />
      </Workspace>
    </>
  );
}

export function TeacherAccountPage({ slug }: { slug: string }) {
  return <PortalAccountData slug={slug} />;
}

export function TeacherStudentsPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <>
      <PageTitleBar title="Students" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" />
      <Workspace>
        <TeacherStudentsData slug={slug} programId={programId} />
      </Workspace>
    </>
  );
}

export function TeacherStudentNotesPage({ slug, programId, studentId }: { slug: string; programId: string; studentId: string }) {
  return (
    <>
      <PageTitleBar title="Student Notes" backHref={`/m/${slug}/teacher/classes/${programId}/students`} backLabel="Students" />
      <Workspace>
        <TeacherStudentNotesData slug={slug} programId={programId} studentId={studentId} />
      </Workspace>
    </>
  );
}

export function TeacherAnnouncementPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <>
      <PageTitleBar title="Announcement" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" />
      <Workspace>
        <TeacherAnnouncementData slug={slug} programId={programId} />
      </Workspace>
    </>
  );
}

export function TeacherProgramFinancesPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <>
      <PageTitleBar title="Finances" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" tone="teal" />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <ProgramFinancesData slug={slug} programId={programId} mode="teacher" />
      </Workspace>
    </>
  );
}

export function TeacherSchedulePage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <>
      <PageTitleBar title="Schedule" backHref={`/m/${slug}/teacher/classes`} backLabel="Classes" />
      <Workspace>
        <TeacherScheduleData slug={slug} programId={programId} />
      </Workspace>
    </>
  );
}

export function TeacherInboxPage({ slug }: { slug: string }) {
  return (
    <>
      <PageTitleBar title="Inbox" tone="teal" />
      <Workspace>
        <TeacherInboxData slug={slug} />
      </Workspace>
    </>
  );
}

export function TeacherAttendancePage({ slug }: { slug: string }) {
  void slug;
  const activeClass = classes[0];
  const attendanceStudents = family.students.concat({ id: "stu-3", name: "Aisha Khan", age: 8, grade: "Grade 3" });

  return (
    <>
      <PageTitleBar title="Attendance" subtitle="Take attendance for the selected class." tone="teal" />
      <ActionToolbar actions={[{ label: "Return" }, { label: "Save", variant: "primary" }, { label: "All Present", variant: "success" }, { label: "All Absent", variant: "danger" }, { label: "Undo" }]} />
      <Workspace>
        <DetailPanel
          title="Class Detail"
          rows={[
            { label: "Class", value: activeClass.name },
            { label: "Teacher", value: activeClass.teacher },
            { label: "Room", value: activeClass.room },
            { label: "Time", value: `${activeClass.day}, ${formatTime(activeClass.startTime)}-${formatTime(activeClass.endTime)}` },
          ]}
        />
        <Panel className="md:hidden">
          {attendanceStudents.map((student, index) => (
            <DataRow
              key={student.id}
              title={student.name}
              subtitle={`${student.grade} - Student ${student.id}`}
              status={<StatusPill status={index === 1 ? "Late" : "Present"} />}
              action={
                <div className="flex gap-2">
                  <FlatButton variant="success" className="min-h-9 px-3">Present</FlatButton>
                  <FlatButton variant="danger" className="min-h-9 px-3">Absent</FlatButton>
                </div>
              }
            />
          ))}
        </Panel>
        <div className="hidden md:block">
          <DataTable
            columns={["Student", "Grade", "Status", "Actions"]}
            rows={attendanceStudents.map((student, index) => [
              student.name,
              student.grade,
              <StatusPill key={`${student.id}-status`} status={index === 1 ? "Late" : "Present"} />,
              <div key={`${student.id}-actions`} className="flex gap-2"><FlatButton variant="success" className="min-h-9 px-3">Present</FlatButton><FlatButton variant="danger" className="min-h-9 px-3">Absent</FlatButton></div>,
            ])}
          />
        </div>
      </Workspace>
    </>
  );
}

export function AdminDashboardPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Home" tone="teal" />
      <Workspace>
        <AdminHomeData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminProgramsPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Classes" tone="teal" />
      <Workspace>
        <AdminClassesData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminEnrollmentsPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Enrollments" subtitle="Review registration requests and statuses." />
      <Workspace>
        <Panel className="md:hidden">
          {enrollments.map((enrollment) => (
            <DataRow key={enrollment.id} title={studentName(enrollment.studentId)} subtitle={className(enrollment.classId)} status={<StatusPill status={enrollment.status} />} />
          ))}
        </Panel>
        <DataTable columns={["Student", "Class", "Status"]} rows={enrollments.map((enrollment) => [studentName(enrollment.studentId), className(enrollment.classId), <StatusPill key={enrollment.id} status={enrollment.status} />])} />
      </Workspace>
    </PageShell>
  );
}

export function AdminStudentsPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Members" tone="teal" />
      <Workspace>
        <AdminMembersData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminMasjidPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Masjid" tone="teal" />
      <Workspace>
        <AdminMasjidData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminMasjidInformationPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Masjid Information" backHref={`/m/${slug}/admin/masjid`} backLabel="Masjid" tone="teal" />
      <Workspace>
        <AdminMasjidInformationData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminProgramDetailPage({ programId, slug }: { programId: string; slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Edit Program" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" tone="teal" />
      <Workspace>
        <TeacherProgramSettingsData slug={slug} programId={programId} returnHref={`/m/${slug}/admin/programs`} />
      </Workspace>
    </PageShell>
  );
}

export function AdminProgramCreatePage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Add Class" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" tone="teal" />
      <Workspace>
        <TeacherProgramCreateData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminInstructorsPage({ programId, slug }: { programId: string; slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Instructors" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" tone="teal" centerBackTitle smallTitle />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <TeacherInstructorsData slug={slug} programId={programId} />
      </Workspace>
    </PageShell>
  );
}

export function AdminProgramStudentsPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Students" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" />
      <Workspace>
        <TeacherStudentsData slug={slug} programId={programId} />
      </Workspace>
    </PageShell>
  );
}

export function AdminStudentNotesPage({ slug, programId, studentId }: { slug: string; programId: string; studentId: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Student Notes" backHref={`/m/${slug}/admin/programs/${programId}/students`} backLabel="Students" />
      <Workspace>
        <TeacherStudentNotesData slug={slug} programId={programId} studentId={studentId} />
      </Workspace>
    </PageShell>
  );
}

export function AdminAnnouncementPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Announcement" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" />
      <Workspace>
        <TeacherAnnouncementData slug={slug} programId={programId} />
      </Workspace>
    </PageShell>
  );
}

export function AdminProgramFinancesPage({ slug, programId }: { slug: string; programId: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Finances" backHref={`/m/${slug}/admin/programs`} backLabel="Classes" tone="teal" />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <ProgramFinancesData slug={slug} programId={programId} mode="admin" />
      </Workspace>
    </PageShell>
  );
}

export function AdminMasjidFinancesPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PageTitleBar title="Finances" backHref={`/m/${slug}/admin/masjid`} backLabel="Masjid" tone="teal" />
      <Workspace overlapOffset="-172px" surfaceClassName="bg-white">
        <AdminMasjidFinancesData slug={slug} />
      </Workspace>
    </PageShell>
  );
}

export function AdminSettingsPage({ slug }: { slug: string }) {
  return (
    <PageShell section="admin" slug={slug}>
      <PortalAccountData slug={slug} />
    </PageShell>
  );
}
