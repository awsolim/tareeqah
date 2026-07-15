"use client";

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ChildrenManager } from "@/components/data/children-manager";
import { TransitionLink } from "@/components/layout/transition-link";
import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties, Dispatch, PointerEvent as ReactPointerEvent, ReactNode, RefObject, SetStateAction, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/data/empty-state";
import { FlatLink } from "@/components/ui/flat-button";
import { getAccountLabel, getDefaultLandingHref } from "@/lib/authz";
import { clearUserScopedCaches, loadCachedSession, loadCachedUserAccess, setCachedProfileName, setCachedProfileSummary, setCachedSessionSnapshot } from "@/lib/client-cache";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type Mosque = Database["public"]["Tables"]["mosques"]["Row"];
type Program = Database["public"]["Tables"]["programs"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProgramDetails = Database["public"]["Tables"]["program_details"]["Row"];
type ProgramOutcome = Database["public"]["Tables"]["program_outcomes"]["Row"];
type ProgramFaq = Database["public"]["Tables"]["program_faqs"]["Row"];
type ProgramContentSection = Database["public"]["Tables"]["program_content_sections"]["Row"];
type ProgramMedia = Database["public"]["Tables"]["program_media"]["Row"];
type ProgramTrack = Database["public"]["Tables"]["program_tracks"]["Row"];
type ProgramStudentNote = Database["public"]["Tables"]["program_student_notes"]["Row"];
type Enrollment = Database["public"]["Tables"]["enrollments"]["Row"];
type EnrollmentRequest = Database["public"]["Tables"]["enrollment_requests"]["Row"];
type WithdrawalRequest = Database["public"]["Tables"]["withdrawal_requests"]["Row"];
type MosqueMembership = Database["public"]["Tables"]["mosque_memberships"]["Row"];
type ProgramTeacher = Database["public"]["Tables"]["program_teachers"]["Row"];
type ProgramInstructorEvent = Database["public"]["Tables"]["program_instructor_events"]["Row"];
type ProgramSubscription = Database["public"]["Tables"]["program_subscriptions"]["Row"];
type ProgramFinanceAuditEvent = Database["public"]["Tables"]["program_finance_audit_events"]["Row"];
type AnnouncementReceipt = Database["public"]["Tables"]["program_announcement_receipts"]["Row"];
type ProgramSessionCancellation = Database["public"]["Tables"]["program_session_cancellations"]["Row"];
type TeacherDisplay = Pick<Profile, "id" | "full_name" | "avatar_url" | "teacher_credentials" | "teacher_whatsapp_number">;
type StudentDisplay = Pick<Profile, "id" | "full_name" | "email" | "phone_number" | "avatar_url" | "age" | "gender" | "date_of_birth" | "account_type">;
type ParentDisplay = Pick<Profile, "id" | "full_name" | "email" | "phone_number" | "avatar_url">;

type ProgramWithTeacher = Program & {
  teacher?: TeacherDisplay | null;
};

type TeacherProgramRole = "director" | "instructor";
type ProgramEditorMediaRow = { id: string; url: string; title: string; mediaType: string; file?: File | null; previewUrl?: string };
type ProgramEditorFaqRow = { id: string; question: string; answer: string };

type AnnouncementWithContext = Database["public"]["Tables"]["program_announcements"]["Row"] & {
  program?: Program | null;
  author?: Profile | null;
  receipt?: AnnouncementReceipt | null;
};

const ANNOUNCEMENT_THREAD_PAGE_SIZE = 25;
const NOTE_THREAD_PAGE_SIZE = 25;
const defaultProgramFaqRows: ProgramEditorFaqRow[] = [
  {
    id: "faq-eligibility",
    question: "Who can join this class?",
    answer: "Students who match the listed age and audience requirements can apply. The teaching team reviews each request before enrollment is confirmed.",
  },
  {
    id: "faq-materials",
    question: "What should students bring?",
    answer: "Bring regular learning materials, a notebook, and anything the instructor requests after enrollment.",
  },
  {
    id: "faq-schedule",
    question: "How do schedule choices work?",
    answer: "If this class has multiple schedules, choose the option that works best when applying. Enrolled families can manage eligible changes from the class page.",
  },
];

type RequestWithContext = EnrollmentRequest & {
  program?: Program | null;
  student?: StudentDisplay | null;
  parent?: ParentDisplay | null;
};
type WithdrawalRequestWithContext = WithdrawalRequest & {
  program?: Program | null;
  student?: StudentDisplay | null;
  parent?: ParentDisplay | null;
  subscription?: ProgramSubscription | null;
};
type InstructorLifecycleNotification = {
  id: string;
  program_id: string;
  assignment_id: string | null;
  teacher_profile_id: string | null;
  event_type: "joined" | "resigned";
  created_at: string | null;
  program?: Program | null;
  instructor?: Profile | null;
};

type ProgramScheduleRow = {
  day: (typeof scheduleDayOptions)[number];
  start: string;
  end: string;
};
type TrackSelectionMode = "exact" | "minimum" | "maximum";

type MosqueProgramsSnapshot = {
  mosque: Mosque;
  programs: ProgramWithTeacher[];
};

type NotificationCounts = {
  announcementCount: number;
  noteCount: number;
  requestCount: number;
};
type EditorToastState = { tone: "success" | "error"; message: string };

type StudentNoteWithContext = ProgramStudentNote & {
  program?: Program | null;
  student?: StudentDisplay | null;
  recipient?: Profile | null;
  author?: Profile | null;
};

type StudentInboxThread =
  | { kind: "announcements"; programId: string }
  | { kind: "notes"; programId: string; studentId: string };
type ProgramScheduleSource = (Program | ProgramWithTeacher) & { scheduleTracks?: ProgramTrack[] };
type EnrollmentTrackSelection = Pick<Enrollment, "id" | "program_id" | "student_profile_id" | "program_track_id">;

const mosqueProgramsCache = new Map<string, MosqueProgramsSnapshot>();
const mosqueProgramsPromises = new Map<string, Promise<MosqueProgramsSnapshot>>();
const notificationCountsCache = new Map<string, NotificationCounts>();

type DevSwitchAccount = {
  id?: string;
  label: string;
  email: string;
  password?: string;
  accountType: "student" | "parent" | "teacher" | "admin";
};

const fallbackDevSwitchAccounts: DevSwitchAccount[] = [
  { label: "Student", email: "student@gmail.com", password: "password", accountType: "student" },
  { label: "Parent", email: "parent@gmail.com", password: "password", accountType: "parent" },
  { label: "Teacher", email: "teacher@gmail.com", password: "password", accountType: "teacher" },
  { label: "Admin", email: "admin@gmail.com", password: "password", accountType: "admin" },
];

const devSwitchAccountsStorageKey = "tareeqah:dev-switch-accounts";
const seenStudentRequestsStorageKey = "tareeqah:seen-student-request-notifications";
const seenTeacherRequestsStorageKey = "tareeqah:seen-teacher-request-notifications";
const dismissedTeacherInstructorUpdatesStorageKey = "tareeqah:dismissed-teacher-instructor-updates";
const editorToastStorageKey = "tareeqah:editor-toast";

function getAnnouncementTargetTrackIds(announcement: Pick<AnnouncementWithContext, "target_program_track_ids">) {
  return announcement.target_program_track_ids ?? [];
}

function getEnrollmentTrackIdsByProgram(enrollments: EnrollmentTrackSelection[], enrollmentTrackRows: Array<{ enrollment_id: string; program_track_id: string }>) {
  const trackIdsByEnrollmentId = new Map<string, string[]>();
  for (const row of enrollmentTrackRows) {
    trackIdsByEnrollmentId.set(row.enrollment_id, [...(trackIdsByEnrollmentId.get(row.enrollment_id) ?? []), row.program_track_id]);
  }

  const trackIdsByProgramId = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const selectedTrackIds = [
      ...(trackIdsByEnrollmentId.get(enrollment.id) ?? []),
      ...(enrollment.program_track_id ? [enrollment.program_track_id] : []),
    ].filter((trackId, index, all) => all.indexOf(trackId) === index);

    const programTrackIds = trackIdsByProgramId.get(enrollment.program_id) ?? new Set<string>();
    for (const trackId of selectedTrackIds) {
      programTrackIds.add(trackId);
    }
    trackIdsByProgramId.set(enrollment.program_id, programTrackIds);
  }

  return trackIdsByProgramId;
}

function isAnnouncementVisibleForEnrollment(announcement: Pick<AnnouncementWithContext, "target_program_track_ids">, enrolledTrackIds: Set<string> | undefined) {
  const targetTrackIds = getAnnouncementTargetTrackIds(announcement);
  if (targetTrackIds.length === 0) {
    return true;
  }
  if (!enrolledTrackIds || enrolledTrackIds.size === 0) {
    return true;
  }
  return targetTrackIds.some((trackId) => enrolledTrackIds.has(trackId));
}

function announcementTargetValue(programId: string, trackId: string | null) {
  return `${programId}:${trackId ?? "all"}`;
}

function parseAnnouncementTargetValue(value: string) {
  const [programId, trackId] = value.split(":");
  return { programId: programId ?? "", trackId: trackId && trackId !== "all" ? trackId : null };
}

function announcementTargetLabel(program: Pick<Program, "title">, track: ProgramTrack | null) {
  return track ? `${program.title} - ${track.name}` : `${program.title} - All Tracks`;
}

function readSeenNotificationIds(storageKey: string, userId: string | null | undefined) {
  if (typeof window === "undefined" || !userId) {
    return new Set<string>();
  }

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || !(userId in parsed)) {
      return new Set<string>();
    }

    const ids = (parsed as Record<string, unknown>)[userId];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function markNotificationIdsSeen(storageKey: string, userId: string | null | undefined, ids: string[]) {
  if (typeof window === "undefined" || !userId || ids.length === 0) {
    return readSeenNotificationIds(storageKey, userId);
  }

  const nextSeen = readSeenNotificationIds(storageKey, userId);
  ids.forEach((id) => nextSeen.add(id));

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    const byUser = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    byUser[userId] = Array.from(nextSeen).slice(-200);
    window.localStorage.setItem(storageKey, JSON.stringify(byUser));
  } catch {
    // Notification badges are convenience state; ignore storage failures.
  }

  window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  return nextSeen;
}

function studentRequestNotificationKey(request: Pick<EnrollmentRequest, "id" | "status" | "reviewed_at" | "requested_at">) {
  return [request.id, request.status, request.reviewed_at ?? request.requested_at ?? ""].join(":");
}

function studentWithdrawalNotificationKey(request: Pick<WithdrawalRequest, "id" | "status" | "reviewed_at" | "requested_at">) {
  return ["withdrawal", request.id, request.status, request.reviewed_at ?? request.requested_at ?? ""].join(":");
}

function teacherRequestNotificationKey(request: Pick<EnrollmentRequest, "id" | "requested_at" | "admission_completed_at">) {
  return request.admission_completed_at ? ["admission-complete", request.id, request.admission_completed_at].join(":") : ["application", request.id, request.requested_at ?? ""].join(":");
}

function teacherInstructorNotificationKey(notification: Pick<InstructorLifecycleNotification, "id" | "event_type" | "teacher_profile_id">) {
  return ["instructor", notification.event_type, notification.id, notification.teacher_profile_id ?? ""].join(":");
}

async function getCurrentAccessToken() {
  const supabase = createSupabaseBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token ?? null;
}

function queueEnrollmentRequestSubmittedEmails(requestIds: string[]) {
  if (requestIds.length === 0) {
    return;
  }

  void (async () => {
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      return;
    }

    await fetch("/api/email/enrollment-request-submitted", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ requestIds }),
    });
  })().catch(() => null);
}

function queueEnrollmentRequestReviewedEmail(requestId: string) {
  void (async () => {
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      return;
    }

    await fetch("/api/email/enrollment-request-reviewed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ requestId }),
    });
  })().catch(() => null);
}

function getDevSwitchAccounts() {
  const storedAccounts = readStoredDevSwitchAccounts();
  const rawAccounts = process.env.NEXT_PUBLIC_DEV_SWITCH_ACCOUNTS;
  if (!rawAccounts) {
    return mergeDevSwitchAccounts(storedAccounts, fallbackDevSwitchAccounts);
  }

  try {
    const parsedAccounts = JSON.parse(rawAccounts);
    if (!Array.isArray(parsedAccounts)) {
      return mergeDevSwitchAccounts(storedAccounts, fallbackDevSwitchAccounts);
    }

    const accounts = parsedAccounts
      .map((account): DevSwitchAccount | null => {
        if (!account || typeof account !== "object") {
          return null;
        }

        const label = "label" in account && typeof account.label === "string" ? account.label : "";
        const email = "email" in account && typeof account.email === "string" ? account.email : "";
        const password = "password" in account && typeof account.password === "string" ? account.password : "";
        const accountType = "accountType" in account && typeof account.accountType === "string" ? account.accountType.toLowerCase() : "";
        if (!label || !email || !password || !isDevAccountType(accountType)) {
          return null;
        }

        return { label, email, password, accountType };
      })
      .filter((account): account is DevSwitchAccount => Boolean(account));

    return mergeDevSwitchAccounts(storedAccounts, accounts.length ? accounts : fallbackDevSwitchAccounts);
  } catch {
    return mergeDevSwitchAccounts(storedAccounts, fallbackDevSwitchAccounts);
  }
}

function isDevAccountType(value: string): value is DevSwitchAccount["accountType"] {
  return value === "student" || value === "parent" || value === "teacher" || value === "admin";
}

function normalizeDevSwitchAccount(account: unknown): DevSwitchAccount | null {
  if (!account || typeof account !== "object") {
    return null;
  }

  const label = "label" in account && typeof account.label === "string" ? account.label : "";
  const email = "email" in account && typeof account.email === "string" ? account.email : "";
  const password = "password" in account && typeof account.password === "string" ? account.password : "";
  const accountType = "accountType" in account && typeof account.accountType === "string" ? account.accountType.toLowerCase() : "";
  if (!label || !email || !password || !isDevAccountType(accountType)) {
    return null;
  }

  return { label, email, password, accountType };
}

function readStoredDevSwitchAccounts() {
  if (typeof window === "undefined") {
    return [] as DevSwitchAccount[];
  }

  try {
    const stored = window.localStorage.getItem(devSwitchAccountsStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeDevSwitchAccount).filter((account): account is DevSwitchAccount => Boolean(account));
  } catch {
    return [];
  }
}

function mergeDevSwitchAccounts(primary: DevSwitchAccount[], fallback: DevSwitchAccount[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((account) => {
    const key = account.email.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function EditorToast({ toast, onClose }: { toast: EditorToastState | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeout = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(timeout);
  }, [onClose, toast]);

  if (!toast || !mounted || typeof document === "undefined") {
    return null;
  }

  const isSuccess = toast.tone === "success";
  return createPortal(
    <div className="fixed left-1/2 top-4 w-[calc(100%-32px)] max-w-sm -translate-x-1/2" style={{ zIndex: 2147483647 }}>
      <div className={cn("flex min-h-12 items-center gap-3 rounded-[10px] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_44px_rgba(38,50,58,0.20)]", isSuccess ? "bg-[#1D8B68]" : "bg-[#C83F31]")}>
        <span className="min-w-0 flex-1">{toast.message}</span>
        <button type="button" onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg leading-none text-white hover:bg-white/25" aria-label="Close notification">
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

function saveDevSwitchAccount(account: DevSwitchAccount) {
  if (typeof window === "undefined") {
    return;
  }
  if (!account.password) {
    return;
  }

  const current = readStoredDevSwitchAccounts();
  const next = [account, ...current.filter((saved) => saved.email.toLowerCase() !== account.email.toLowerCase())].slice(0, 12);
  window.localStorage.setItem(devSwitchAccountsStorageKey, JSON.stringify(next));
}

function queueEditorToast(toast: EditorToastState) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(editorToastStorageKey, JSON.stringify(toast));
}

function readQueuedEditorToast() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(editorToastStorageKey);
    window.sessionStorage.removeItem(editorToastStorageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<EditorToastState>;
    if ((parsed.tone === "success" || parsed.tone === "error") && typeof parsed.message === "string" && parsed.message.trim()) {
      return { tone: parsed.tone, message: parsed.message };
    }
  } catch {
    window.sessionStorage.removeItem(editorToastStorageKey);
  }
  return null;
}

export function MosqueDirectoryRows() {
  const [mosques, setMosques] = useState<Mosque[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase
      .from("mosques")
      .select("*")
      .order("name", { ascending: true })
      .then(({ data, error: queryError }) => {
        setLoading(false);
        if (queryError) {
          setError(queryError.message);
          return;
        }
        setMosques(data ?? []);
      });
  }, []);

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error) {
    return <EmptyState title="Could not load masjids" text={error} />;
  }

  if (mosques.length === 0) {
    return <EmptyState title="No masjids yet" text="Masjids added in Supabase will appear here." />;
  }

  return (
    <>
      {mosques.map((mosque) => (
        <div key={mosque.id} className="flex min-h-20 items-center gap-3 border-b border-[#D6DCE0] px-4 py-3 last:border-b-0">
          <Logo src={mosque.logo_url} name={mosque.name} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-medium text-[#26323A]">{mosque.name}</h2>
          </div>
          <FlatLink href={`/m/${mosque.slug}`} variant="primary" className="shrink-0">
            Open
          </FlatLink>
        </div>
      ))}
    </>
  );
}

export function PublicMasjidData({ slug }: { slug: string }) {
  return <StudentHomeData slug={slug} />;
}

export function StudentHomeData({ slug }: { slug: string }) {
  const { programs, enrolledProgramIds, programOwnerLabels, programTracksByProgramId, loading, enrollmentLoading, error } = useStudentPrograms(slug);
  const { unreadCount } = useStudentUnreadAnnouncements(slug);

  if (loading || enrollmentLoading) {
    return <HomeLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load masjid" text={error} />;
  }

  const enrolledPrograms = programs
    .filter((program) => enrolledProgramIds.includes(program.id))
    .map((program) => ({
      ...program,
      scheduleTracks: programTracksByProgramId[program.id],
    }));

  return (
    <section className="space-y-5 bg-[var(--workspace)] p-4">
      <HomeNotification
        tone={unreadCount > 0 ? "active" : "empty"}
        title={unreadCount > 0 ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}` : "No new inbox items"}
        text={unreadCount > 0 ? "Class messages are waiting in your inbox." : "New announcements, notes, and updates will appear here."}
        href={unreadCount > 0 ? `/m/${slug}/portal/announcements` : undefined}
      />
      <HomeSectionTitle title="Upcoming" />
      {enrolledPrograms.length === 0 ? (
        <HomeEmptyState title="You are not enrolled in any classes" text="Your next lesson will appear here after enrollment." />
      ) : (
        <HomeUpcomingRows programs={enrolledPrograms} ownerLabelsByProgramId={programOwnerLabels} />
      )}
    </section>
  );
}

export function PublicProgramsData({ slug }: { slug: string }) {
  const { mosque, programs, loading, error } = useMosquePrograms(slug);

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error) {
    return <EmptyState title="Could not load programs" text={error} />;
  }

  if (!mosque) {
    return <EmptyState title="Masjid not found" text="Programs could not be loaded for this masjid." />;
  }

  return <ProgramCardGrid programs={programs} mosqueSlug={mosque.slug} emptyText="No programs are available at this masjid yet." />;
}

export function ProgramDetailData({ slug, programId, section = "public" }: { slug: string; programId: string; section?: "public" | "portal" | "teacher" }) {
  const [mosque, setMosque] = useState<Mosque | null>(null);
  const [program, setProgram] = useState<ProgramWithTeacher | null>(null);
  const [details, setDetails] = useState<ProgramDetails | null>(null);
  const [outcomes, setOutcomes] = useState<ProgramOutcome[]>([]);
  const [contentSections, setContentSections] = useState<ProgramContentSection[]>([]);
  const [faqs, setFaqs] = useState<ProgramFaq[]>([]);
  const [mediaItems, setMediaItems] = useState<ProgramMedia[]>([]);
  const [tracks, setTracks] = useState<ProgramTrack[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<string | null>(null);
  const [selfProfile, setSelfProfile] = useState<StudentDisplay | null>(null);
  const [parentChildren, setParentChildren] = useState<StudentDisplay[]>([]);
  const [childStatuses, setChildStatuses] = useState<Record<string, { enrolled: boolean; requestStatus: string | null }>>({});
  const [childSelectorOpen, setChildSelectorOpen] = useState(false);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isStaffForProgram, setIsStaffForProgram] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    loadCachedSession().then((session) => {
      setIsSignedIn(Boolean(session));
      setCurrentUserId(session?.user.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session));
      setCurrentUserId(session?.user.id ?? null);
    });

    async function load() {
      const session = await loadCachedSession();
      const userId = session?.user.id ?? null;

      const { data: mosqueData, error: mosqueError } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();
      if (mosqueError) {
        setError(mosqueError.message);
        setLoading(false);
        return;
      }

      if (!mosqueData) {
        setLoading(false);
        return;
      }

      const { data: programData, error: programError } = await supabase
        .from("programs")
        .select("*")
        .eq("id", programId)
        .eq("mosque_id", mosqueData.id)
        .maybeSingle();

      if (programError) {
        setError(programError.message);
        setLoading(false);
        return;
      }

      let teacher: TeacherDisplay | null = null;
      const directorProfileId = programData?.director_profile_id ?? programData?.teacher_profile_id ?? null;
      if (directorProfileId) {
        const { data: teacherData } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, teacher_credentials, teacher_whatsapp_number")
          .eq("id", directorProfileId)
          .maybeSingle();
        teacher = teacherData ?? null;
      }

      if (programData) {
        const [detailsResult, outcomesResult, contentResult, faqResult, mediaResult, tracksResult] = await Promise.all([
          supabase.from("program_details").select("*").eq("program_id", programData.id).maybeSingle(),
          supabase.from("program_outcomes").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_content_sections").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_faqs").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_media").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_tracks").select("*").eq("program_id", programData.id).eq("is_active", true).order("sort_order", { ascending: true }),
        ]);

        setDetails(detailsResult.data ?? null);
        setOutcomes(outcomesResult.data ?? []);
        setContentSections(contentResult.data ?? []);
        setFaqs(faqResult.data ?? []);
        setMediaItems(mediaResult.data ?? []);
        const activeTracks = tracksResult.data ?? [];
        setTracks(activeTracks);
        setSelectedTrackIds((current) => {
          if (current.length) {
            return current.filter((trackId) => activeTracks.some((track) => track.id === trackId));
          }
          return activeTracks[0]?.id ? [activeTracks[0].id] : [];
        });

        if (userId) {
          const [profileResult, enrollmentResult, requestResult, teacherAssignmentResult, access] = await Promise.all([
            supabase
              .from("profiles")
              .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type")
              .eq("id", userId)
              .maybeSingle(),
            supabase.from("enrollments").select("*").eq("program_id", programData.id).eq("student_profile_id", userId).maybeSingle(),
            supabase
              .from("enrollment_requests")
              .select("*")
              .eq("program_id", programData.id)
              .eq("student_profile_id", userId)
              .is("student_dismissed_at", null)
              .order("requested_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase.from("program_teachers").select("program_id").eq("program_id", programData.id).eq("teacher_profile_id", userId).maybeSingle(),
            loadCachedUserAccess(slug, userId),
          ]);
          const nextAccountType = profileResult.data?.account_type ?? access.accountType ?? null;
          setAccountType(nextAccountType);
          setSelfProfile((profileResult.data as StudentDisplay | null) ?? null);
          setIsEnrolled(Boolean(enrollmentResult.data));
          setRequestStatus(requestResult.data?.status ?? null);
          setIsStaffForProgram(Boolean(teacherAssignmentResult.data) || directorProfileId === userId || access.isMosqueAdmin);

          if (nextAccountType === "parent") {
            const { children } = await fetchParentChildren(supabase, slug, userId, mosqueData.id);
            setParentChildren(children);
            const childIds = children.map((child) => child.id);
            if (childIds.length) {
              const [childEnrollments, childRequests] = await Promise.all([
                supabase.from("enrollments").select("student_profile_id").eq("program_id", programData.id).in("student_profile_id", childIds),
                supabase
                  .from("enrollment_requests")
                  .select("student_profile_id, status")
                  .eq("program_id", programData.id)
                  .eq("parent_profile_id", userId)
                  .in("student_profile_id", childIds)
                  .is("student_dismissed_at", null)
                  .order("requested_at", { ascending: false }),
              ]);
              const enrolledChildIds = new Set((childEnrollments.data ?? []).map((row) => row.student_profile_id));
              const statuses: Record<string, { enrolled: boolean; requestStatus: string | null }> = {};
              for (const child of children) {
                statuses[child.id] = {
                  enrolled: enrolledChildIds.has(child.id),
                  requestStatus: childRequests.data?.find((row) => row.student_profile_id === child.id)?.status ?? null,
                };
              }
              setChildStatuses(statuses);
            } else {
              setChildStatuses({});
            }
          } else {
            setParentChildren([]);
            setChildStatuses({});
          }
        } else {
          setAccountType(null);
          setSelfProfile(null);
          setParentChildren([]);
          setChildStatuses({});
          setIsEnrolled(false);
          setRequestStatus(null);
          setIsStaffForProgram(false);
        }
      }

      setMosque(mosqueData);
      setProgram(programData ? { ...programData, teacher } : null);
      setLoading(false);
    }

    load();

    return () => {
      subscription.unsubscribe();
    };
  }, [programId, slug]);

  if (loading) {
    return <ProgramDetailLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load program" text={error} />;
  }

  if (!mosque || !program) {
    return <EmptyState title="Program not found" text="This class may no longer be available." />;
  }

  const teacherName = details?.instructor_display_name?.trim() || program.teacher?.full_name || "Teacher to be announced";
  const isTeacherContext = section === "teacher";
  const teacherCredentials = details?.instructor_credentials?.trim() ?? "";
  const teacherWhatsAppHref = getWhatsAppHref(details?.instructor_contact_phone?.trim() || program.teacher?.teacher_whatsapp_number);
  const age = formatAgeRange(program.age_range_text);
  const gender = formatGender(program.audience_gender);
  const price = formatPrice(program.price_monthly_cents);
  const schedule = scheduleSummary(program.schedule, program.schedule_notes);
  const selectedTracks = tracks.filter((track) => selectedTrackIds.includes(track.id));
  const selectedTrackSchedule = selectedTracks.length
    ? {
        short: selectedTracks.map((track) => track.name).join(", "),
        full: selectedTracks.map((track) => `${track.name}: ${scheduleSummary(track.schedule, null).full}`).join("; "),
      }
    : schedule;
  const learningIntro = details?.learning_intro?.trim() ?? "";
  const learningOutcomes = outcomes.map((item) => item.text);
  const hasLearningSection = Boolean(learningIntro) || learningOutcomes.length > 0;
  const classContent = contentSections;
  const hasContentSection = classContent.length > 0;
  const galleryItems = mediaItems;
  const hasMediaSection = galleryItems.length > 0;
  const selfEligibility = accountType === "student" ? isProfileEligibleForProgram(selfProfile, program) : { eligible: true, reason: null };
  const parentApplicantProfiles = accountType === "parent" ? [selfProfile, ...parentChildren].filter((profile): profile is StudentDisplay => Boolean(profile?.id)) : [];
  const parentApplicantStatuses =
    accountType === "parent" && currentUserId
      ? {
          ...childStatuses,
          [currentUserId]: { enrolled: isEnrolled, requestStatus },
        }
      : childStatuses;
  const viewerHasActiveEnrollment =
    isEnrolled || (accountType === "parent" && Object.values(childStatuses).some((status) => status.enrolled));

  async function requestEnrollment() {
    if (!currentUserId || !mosque || !program) {
      return;
    }

    setRequestBusy(true);
    setRequestMessage(null);
    const supabase = createSupabaseBrowserClient();
    const trackValidation = validateTrackSelection(program, tracks, selectedTrackIds);
    if (!trackValidation.valid) {
      setRequestMessage(trackValidation.message);
      setRequestBusy(false);
      return;
    }
    const primaryTrackId = selectedTrackIds[0] ?? null;

    if (accountType === "teacher") {
      setRequestMessage("Teacher accounts cannot request enrollment in classes.");
      setRequestBusy(false);
      return;
    }

    if (accountType === "parent") {
      const requestableStudentIds = selectedChildIds.filter((studentId) => {
        const status = parentApplicantStatuses[studentId];
        const applicant = studentId === currentUserId ? selfProfile : parentChildren.find((item) => item.id === studentId);
        return Boolean(applicant) && isProfileEligibleForProgram(applicant, program).eligible && !status?.enrolled && status?.requestStatus !== "pending" && status?.requestStatus !== "waitlisted";
      });

      if (requestableStudentIds.length === 0) {
        setRequestMessage("Select at least one eligible student who is not already enrolled, pending review, or waitlisted.");
        setRequestBusy(false);
        return;
      }

      const { data: parentRequestRows, error: parentInsertError } = await supabase
        .from("enrollment_requests")
        .upsert(
          requestableStudentIds.map((studentId) => ({
            mosque_id: mosque.id,
            program_id: program.id,
            program_track_id: primaryTrackId,
            student_profile_id: studentId,
            parent_profile_id: studentId === currentUserId ? null : currentUserId,
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            decision_note: null,
            approved_price_monthly_cents: null,
            payment_bypassed: false,
            admission_completed_at: null,
            student_dismissed_at: null,
          })),
          { onConflict: "program_id,student_profile_id" },
        )
        .select("id, student_profile_id");

      if (parentInsertError) {
        setRequestMessage(parentInsertError.message);
        setRequestBusy(false);
        return;
      }
      const trackWriteError = await replaceEnrollmentRequestTracks(
        supabase,
        (parentRequestRows ?? []).map((row) => row.id),
        selectedTrackIds,
      );
      if (trackWriteError) {
        setRequestMessage(trackWriteError);
        setRequestBusy(false);
        return;
      }

      setChildStatuses((current) => {
        const next = { ...current };
        for (const studentId of requestableStudentIds) {
          if (studentId === currentUserId) {
            continue;
          }
          next[studentId] = { enrolled: false, requestStatus: "pending" };
        }
        return next;
      });
      if (requestableStudentIds.includes(currentUserId)) {
        setRequestStatus("pending");
      }
      setSelectedChildIds([]);
      setChildSelectorOpen(false);
      setToast({ tone: "success", message: `${requestableStudentIds.length} enrollment request${requestableStudentIds.length === 1 ? "" : "s"} sent. Check inbox for status.` });
      queueEnrollmentRequestSubmittedEmails((parentRequestRows ?? []).map((row) => row.id));
      setRequestBusy(false);
      return;
    }

    const eligibility = isProfileEligibleForProgram(selfProfile, program);
    if (!eligibility.eligible) {
      setRequestMessage(eligibility.reason ?? "This class is not available for this profile.");
      setRequestBusy(false);
      return;
    }

    const { data: requestRows, error: insertError } = await supabase
      .from("enrollment_requests")
      .upsert(
        {
          mosque_id: mosque.id,
          program_id: program.id,
          program_track_id: primaryTrackId,
          student_profile_id: currentUserId,
          parent_profile_id: null,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
          decision_note: null,
          approved_price_monthly_cents: null,
          payment_bypassed: false,
          admission_completed_at: null,
          student_dismissed_at: null,
        },
        { onConflict: "program_id,student_profile_id" },
      )
      .select("id");

    if (insertError) {
      setRequestMessage(insertError.message);
      setRequestBusy(false);
      return;
    }
    const trackWriteError = await replaceEnrollmentRequestTracks(supabase, (requestRows ?? []).map((row) => row.id), selectedTrackIds);
    if (trackWriteError) {
      setRequestMessage(trackWriteError);
      setRequestBusy(false);
      return;
    }

    setRequestStatus("pending");
    setToast({ tone: "success", message: "Enrollment request sent. Check inbox for status." });
    queueEnrollmentRequestSubmittedEmails((requestRows ?? []).map((row) => row.id));
    setRequestBusy(false);
  }

  return (
    <div className="bg-[var(--workspace)] p-4">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <div className="space-y-5">
        <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
          <ProgramHero program={program} />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#17624F]">
              <span>{mosque.name}</span>
              <span aria-hidden>•</span>
              <span>{age}</span>
              <span aria-hidden>•</span>
              <span>{gender}</span>
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-8 text-[#26323A]">{program.title}</h1>
              <p className="mt-2 text-sm leading-7 text-[#52616A]">{program.description || mockProgramDescription(program.title)}</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-5">
            {hasLearningSection ? (
              <DetailSection title={details?.learning_title?.trim() || "What You Will Learn"}>
                {learningIntro ? <p className="text-sm leading-7 text-[#52616A]">{learningIntro}</p> : null}
                {learningOutcomes.length > 0 ? (
                  <div className={cn("grid gap-3 sm:grid-cols-2", learningIntro ? "mt-5" : "")}>
                    {learningOutcomes.map((item) => (
                      <div key={item} className="flex gap-3 text-sm text-[#26323A]">
                        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3F5EE] text-xs font-semibold text-[#228763]">✓</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </DetailSection>
            ) : null}

            {hasContentSection ? (
              <DetailSection title="Class Content">
                <div className="divide-y divide-[#E6ECEF]">
                  {classContent.map((row, index) => (
                    <div key={row.title} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F0F8FB] text-xs font-medium text-[#2F8FB3]">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#26323A]">{row.title}</p>
                        <p className="text-xs text-[#6B747B]">{contentDescription(row)}</p>
                      </div>
                      <span className="rounded-full bg-[#EAF7F1] px-2 py-1 text-xs text-[#228763]">{contentDuration(row)}</span>
                    </div>
                  ))}
                </div>
              </DetailSection>
            ) : null}

            {hasMediaSection ? <ProgramMediaGallery items={galleryItems} /> : null}
          </div>

          <div className="space-y-4 lg:sticky lg:top-24">
            <aside className="rounded-2xl border border-[#C8DCE2] bg-white p-4 shadow-[0_14px_34px_rgba(38,50,58,0.10)]">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-semibold text-[#26323A]">{price}</p>
                {program.is_paid ? <span className="text-xs text-[#6B747B]">monthly</span> : null}
              </div>
              {tracks.length > 0 ? (
                <ProgramTrackSelector
                  tracks={tracks}
                  selectedTrackIds={selectedTrackIds}
                  program={program}
                  onToggle={(trackId) =>
                    setSelectedTrackIds((current) => nextProgramTrackSelection(program, tracks, current, trackId))
                  }
                />
              ) : null}
              {isSignedIn ? (
                isTeacherContext || isStaffForProgram ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#EEF6F8] px-4 text-sm font-semibold text-[#2F6F83] ring-1 ring-[#CFE2E8]">
                    {accountType === "admin" ? "Admin Control" : "Teaching"}
                  </div>
                ) : accountType === "admin" ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#EEF6F8] px-4 text-sm font-semibold text-[#2F6F83] ring-1 ring-[#CFE2E8]">
                    Admin Account
                  </div>
                ) : accountType === "teacher" ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#EEF6F8] px-4 text-sm font-semibold text-[#2F6F83] ring-1 ring-[#CFE2E8]">
                    Teacher Account
                  </div>
                ) : accountType === "parent" ? (
                  <>
                    {childSelectorOpen ? (
                      <ChildEnrollmentSelector
                        program={program}
                        childrenProfiles={parentApplicantProfiles}
                        statuses={parentApplicantStatuses}
                        selfProfileId={currentUserId}
                        selectedChildIds={selectedChildIds}
                        onToggle={(childId) =>
                          setSelectedChildIds((current) =>
                            current.includes(childId) ? current.filter((id) => id !== childId) : [...current, childId],
                          )
                        }
                        onSubmit={requestEnrollment}
                        busy={requestBusy}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setChildSelectorOpen(true)}
                          disabled={parentApplicantProfiles.length === 0}
                          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#248B72] px-4 text-sm font-semibold !text-white shadow-[0_10px_22px_rgba(36,139,114,0.24)] transition-colors hover:bg-[#17624F] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Request Enrollment
                        </button>
                        {parentApplicantProfiles.length === 0 ? (
                          <p className="mt-3 rounded-xl bg-[#FFF7E6] p-3 text-sm leading-6 text-[#8A5A00]">Complete your profile before requesting enrollment.</p>
                        ) : null}
                      </>
                    )}
                  </>
                ) : isEnrolled ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#E8F7F2] px-4 text-sm font-semibold text-[#17624F] ring-1 ring-[#B9E4D7]">
                    Enrolled
                  </div>
                ) : requestStatus === "pending" ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#FFF7E6] px-4 text-sm font-semibold text-[#8A5A00] ring-1 ring-[#F3D28A]">
                    Pending Review
                  </div>
                ) : requestStatus === "waitlisted" ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-[#8A6418] ring-1 ring-[#FFE3A3]">
                    Waitlisted
                  </div>
                ) : !selfEligibility.eligible ? (
                  <div className="mt-4 rounded-2xl bg-[#FFF7E6] p-4 text-sm leading-6 text-[#8A5A00] ring-1 ring-[#F3D28A]">
                    {selfEligibility.reason ?? "This class is not available for this profile."}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={requestEnrollment}
                    disabled={requestBusy}
                    className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#248B72] px-4 text-sm font-semibold !text-white shadow-[0_10px_22px_rgba(36,139,114,0.24)] transition-colors hover:bg-[#17624F] disabled:opacity-60"
                  >
                    {requestBusy ? "Sending..." : "Request Enrollment"}
                  </button>
                )
              ) : (
                <Link href={`/m/${slug}/login`} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#248B72] px-4 text-sm font-semibold !text-white shadow-[0_10px_22px_rgba(36,139,114,0.24)] transition-colors hover:bg-[#17624F]">
                  Log In to Request Enrollment
                </Link>
              )}
              {requestMessage ? (
                <div className="mt-3 rounded-xl border border-[#F3D28A] bg-[#FFF7E6] p-3 text-sm leading-6 text-[#8A5A00]">
                  <p>{requestMessage}</p>
                </div>
              ) : null}

              <dl className="mt-5 divide-y divide-[#E6ECEF] text-sm">
                <SidebarFact label="Age" value={age} />
                <SidebarFact label="Audience" value={gender} />
                <SidebarFact label="Schedule" value={selectedTrackSchedule.full} />
                {section === "portal" && viewerHasActiveEnrollment ? (
                  <div className="py-3 text-xs leading-5 text-[#6B747B]">
                    Go to Schedule Options from your class card to view different schedule options.
                  </div>
                ) : null}
                <SidebarFact label="Status" value={program.is_active ? "Open" : "Closed"} />
              </dl>
            </aside>

            <section className="overflow-hidden rounded-[24px] bg-[#17624F] p-4 text-white shadow-[0_16px_34px_rgba(23,98,79,0.20)]">
              <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Program Director</p>
              <div className="mt-4 flex items-center gap-4">
                <Avatar src={program.teacher?.avatar_url ?? null} name={teacherName} />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-white">{teacherName}</h2>
                </div>
              </div>
              {teacherCredentials ? <p className="mt-4 text-sm leading-7 text-white/82">{teacherCredentials}</p> : null}
              <div className="mt-5 flex justify-center">
                {teacherWhatsAppHref ? (
                  <a
                    href={teacherWhatsAppHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold !text-[#17624F] shadow-[0_10px_20px_rgba(15,69,55,0.22)] ring-1 ring-white/70 transition-colors hover:bg-[#F4FBF8]"
                    style={{ color: "#17624F" }}
                  >
                    <MessageIcon className="text-[#17624F]" style={{ color: "#17624F" }} />
                    <span className="!text-[#17624F]" style={{ color: "#17624F" }}>
                      Contact
                    </span>
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-white/12 px-5 text-sm font-semibold text-white/75 ring-1 ring-white/20">
                    <MessageIcon />
                    Contact unavailable
                  </span>
                )}
              </div>
            </section>

            {faqs.length ? <ProgramFaqSection faqs={faqs} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentClassesData({ slug }: { slug: string }) {
  const { mosque, programs, enrolledProgramIds, loading, enrollmentLoading, error } = useStudentPrograms(slug);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStudentClassesTab = searchParams.get("tab");
  const [tab, setTab] = useState<"enrolled" | "browse">(initialStudentClassesTab === "browse" ? "browse" : "enrolled");

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (nextTab === "enrolled" || nextTab === "browse") {
      setTab(nextTab);
    }
  }, [searchParams]);

  function changeClassesTab(nextTab: "enrolled" | "browse") {
    setTab(nextTab);
    router.replace(`/m/${slug}/portal/classes?tab=${nextTab}`, { scroll: false });
  }

  const enrolledPrograms = programs.filter((program) => enrolledProgramIds.includes(program.id));
  const browsePrograms = programs;

  let content: ReactNode;
  if (loading || enrollmentLoading) {
    content = <ClassesLoadingPlaceholders count={tab === "browse" ? 2 : 1} />;
  } else if (error) {
    content = <EmptyState title="Could not load classes" text={error} />;
  } else if (!mosque) {
    content = <EmptyState title="Masjid not found" text="Classes could not be loaded for this masjid." />;
  } else if (tab === "enrolled") {
    content =
      enrolledPrograms.length === 0 ? (
        <EmptyState title="You are not enrolled in any classes" text="Browse available classes to find a program." />
      ) : (
        <EnrolledClassList programs={enrolledPrograms} mosqueSlug={mosque.slug} />
      );
  } else {
    content = <ProgramCardGrid programs={browsePrograms} mosqueSlug={mosque.slug} emptyText="No available classes to browse right now." enrolledProgramIds={enrolledProgramIds} detailBaseHref={`/m/${mosque.slug}/portal/classes`} />;
  }

  return (
    <section className="bg-[var(--workspace)]">
      <div className="grid grid-cols-2 border-b border-[#D6DCE0] md:hidden">
        <button
          type="button"
          onClick={() => changeClassesTab("enrolled")}
          className={cn("min-h-12 text-sm font-medium", tab === "enrolled" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          Enrolled
        </button>
        <button
          type="button"
          onClick={() => changeClassesTab("browse")}
          className={cn("min-h-12 text-sm font-medium", tab === "browse" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          Browse
        </button>
      </div>

      {content}
    </section>
  );
}

type ScheduleOptionEnrollment = {
  enrollment: Enrollment;
  student: StudentDisplay | null;
  selectedTrackIds: string[];
  draftTrackIds: string[];
  message: { tone: "success" | "error"; text: string } | null;
};

export function StudentScheduleOptionsData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [tracks, setTracks] = useState<ProgramTrack[]>([]);
  const [items, setItems] = useState<ScheduleOptionEnrollment[]>([]);
  const [savingEnrollmentId, setSavingEnrollmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;
      if (!userId) {
        setError("Please sign in to manage schedule options.");
        setLoading(false);
        return;
      }

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setError("Masjid not found.");
        setLoading(false);
        return;
      }

      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type")
        .eq("id", userId)
        .maybeSingle();
      const { children } = currentProfile?.account_type === "parent" ? await fetchParentChildren(supabase, slug, userId, mosque.id) : { children: [] as StudentDisplay[] };
      const possibleStudents = [currentProfile, ...children].filter(Boolean) as StudentDisplay[];
      const possibleStudentIds = possibleStudents.map((student) => student.id);
      if (!possibleStudentIds.length) {
        setError("No student profile is available for this account.");
        setLoading(false);
        return;
      }

      const [{ data: programRow }, { data: trackRows }, { data: enrollmentRows, error: enrollmentError }] = await Promise.all([
        supabase.from("programs").select("*").eq("id", programId).eq("mosque_id", mosque.id).maybeSingle(),
        supabase.from("program_tracks").select("*").eq("program_id", programId).eq("is_active", true).order("sort_order", { ascending: true }),
        supabase.from("enrollments").select("*").eq("program_id", programId).in("student_profile_id", possibleStudentIds),
      ]);

      if (enrollmentError) {
        setError(enrollmentError.message);
        setLoading(false);
        return;
      }
      if (!programRow) {
        setError("Class not found.");
        setLoading(false);
        return;
      }

      const enrollmentIds = (enrollmentRows ?? []).map((enrollment) => enrollment.id);
      const { data: enrollmentTrackRows } = enrollmentIds.length
        ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
        : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };
      const trackIdsByEnrollmentId = new Map<string, string[]>();
      for (const row of enrollmentTrackRows ?? []) {
        trackIdsByEnrollmentId.set(row.enrollment_id, [...(trackIdsByEnrollmentId.get(row.enrollment_id) ?? []), row.program_track_id]);
      }

      const nextItems = (enrollmentRows ?? []).map((enrollment) => {
        const selectedTrackIds = [
          ...(trackIdsByEnrollmentId.get(enrollment.id) ?? []),
          ...(enrollment.program_track_id ? [enrollment.program_track_id] : []),
        ].filter((trackId, index, all) => all.indexOf(trackId) === index && (trackRows ?? []).some((track) => track.id === trackId));
        return {
          enrollment,
          student: possibleStudents.find((student) => student.id === enrollment.student_profile_id) ?? null,
          selectedTrackIds,
          draftTrackIds: selectedTrackIds,
          message: null,
        };
      });

      if (!cancelled) {
        setProgram(programRow);
        setTracks(trackRows ?? []);
        setItems(nextItems);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [programId, slug]);

  function updateDraft(enrollmentId: string, trackId: string) {
    if (!program) {
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.enrollment.id === enrollmentId
          ? {
              ...item,
              draftTrackIds: nextScheduleOptionSelection(program, tracks, item.draftTrackIds, trackId),
              message: null,
            }
          : item,
      ),
    );
  }

  async function saveSelection(item: ScheduleOptionEnrollment) {
    if (!program) {
      return;
    }
    const eligibility = isProfileEligibleForProgram(item.student, program);
    if (!eligibility.eligible) {
      setItems((current) => current.map((row) => (row.enrollment.id === item.enrollment.id ? { ...row, message: { tone: "error", text: eligibility.reason ?? "This student is not eligible for this class." } } : row)));
      return;
    }
    const validation = validateTrackSelection(program, tracks, item.draftTrackIds);
    if (!validation.valid) {
      setItems((current) => current.map((row) => (row.enrollment.id === item.enrollment.id ? { ...row, message: { tone: "error", text: validation.message } } : row)));
      return;
    }

    setSavingEnrollmentId(item.enrollment.id);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.rpc("update_enrollment_track_selection", {
      target_enrollment_id: item.enrollment.id,
      selected_track_ids: item.draftTrackIds,
    });

    setItems((current) =>
      current.map((row) =>
        row.enrollment.id === item.enrollment.id
          ? updateError
            ? { ...row, message: { tone: "error", text: updateError.message } }
            : { ...row, selectedTrackIds: item.draftTrackIds, message: { tone: "success", text: "Schedule options updated." } }
          : row,
      ),
    );
    setSavingEnrollmentId(null);
    if (!updateError) {
      window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    }
  }

  if (loading) {
    return <InboxLoadingPanel label="Loading schedule options" />;
  }

  if (error) {
    return <EmptyState title="Could not load schedule options" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="Schedule options could not be loaded." />;
  }

  const ruleText = trackSelectionRuleText(program, tracks.length);

  return (
    <section className="min-h-[calc(100vh-260px)] bg-white px-5 pb-28 pt-5 text-[#26323A]">
      <div className="border-b border-[#E1E8EC] pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6B747B]">Schedule control</p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight">{program.title}</h2>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
          <span className="text-[#6B747B]">Rule</span>
          <span className="text-right font-semibold text-[#17624F]">{ruleText}</span>
          <span className="text-[#6B747B]">Eligibility</span>
          <span className="text-right font-semibold">{formatAgeRange(program.age_range_text)} · {formatGender(program.audience_gender)}</span>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="py-8">
          <MiniEmpty text="This class does not have multiple schedule options." />
        </div>
      ) : items.length === 0 ? (
        <div className="py-8">
          <MiniEmpty text="No active enrollment was found for this class." />
        </div>
      ) : (
        <div className="divide-y divide-[#E1E8EC]">
          {items.map((item) => {
            const studentName = item.student?.full_name?.trim() || "Student";
            const eligibility = isProfileEligibleForProgram(item.student, program);
            const validation = validateTrackSelection(program, tracks, item.draftTrackIds);
            const dirty = !sameStringSet(item.selectedTrackIds, item.draftTrackIds);
            const canSave = dirty && eligibility.eligible && validation.valid && savingEnrollmentId !== item.enrollment.id;
            return (
              <section key={item.enrollment.id} className="py-5">
                <div className="flex items-start gap-3">
                  <Avatar src={item.student?.avatar_url ?? null} name={studentName} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{studentName}</h3>
                    <p className="mt-1 text-xs font-medium text-[#6B747B]">{item.draftTrackIds.length} selected · {dirty ? "Unsaved changes" : "Current schedule"}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!canSave}
                    onClick={() => void saveSelection(item)}
                    className="min-h-9 shrink-0 rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white disabled:bg-[#D8E2E5] disabled:text-[#8A949B]"
                  >
                    {savingEnrollmentId === item.enrollment.id ? "Saving" : "Save"}
                  </button>
                </div>

                {!eligibility.eligible ? <p className="mt-3 text-sm font-semibold text-[#A34B16]">{eligibility.reason}</p> : null}
                {eligibility.eligible && !validation.valid ? <p className="mt-3 text-sm font-semibold text-[#A34B16]">{validation.message}</p> : null}
                {item.message ? <p className={cn("mt-3 text-sm font-semibold", item.message.tone === "success" ? "text-[#17624F]" : "text-[#A34B16]")}>{item.message.text}</p> : null}

                <div className="mt-4 divide-y divide-[#EEF2F4] border-y border-[#EEF2F4]">
                  {tracks.map((track, index) => (
                    <ScheduleTrackControlRow
                      key={track.id}
                      index={index}
                      track={track}
                      trackCount={tracks.length}
                      program={program}
                      selectedTrackIds={item.draftTrackIds}
                      disabled={!eligibility.eligible}
                      onToggle={() => updateDraft(item.enrollment.id, track.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

type AccountPanel = "menu" | "settings" | "family" | "billing" | "security" | "homescreen" | "photo" | "switchAccount";
type EditableProfileField = "fullName" | "password" | "email" | "dateOfBirth" | "phone";

export function PortalAccountData({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionEmail, setSessionEmail] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  const [accountLabel, setAccountLabel] = useState("Account");
  const [isParent, setIsParent] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(true);
  const [activePanel, setActivePanel] = useState<AccountPanel>("menu");
  const [panelMotion, setPanelMotion] = useState<"forward" | "back">("forward");
  const [hasPanelNavigated, setHasPanelNavigated] = useState(false);
  const [profileForm, setProfileForm] = useState({ avatarUrl: "", fullName: "", phone: "", dateOfBirth: "", email: "", password: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableProfileField | null>(null);
  const [photoDraftUrl, setPhotoDraftUrl] = useState("");
  const [photoScale, setPhotoScale] = useState(1);
  const [photoOffset, setPhotoOffset] = useState({ x: 0, y: 0 });
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchBusyEmail, setSwitchBusyEmail] = useState<string | null>(null);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const [devSwitchAccounts, setDevSwitchAccounts] = useState<DevSwitchAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const canUseAccountSwitcher = true;

  useEffect(() => {
    const panelParam = searchParams.get("panel");
    if (!panelParam || !isAccountPanel(panelParam)) {
      return;
    }

    setActivePanel(panelParam);
    setPanelMotion("forward");
    setHasPanelNavigated(false);
    setEditingField(null);
    setProfileMessage(null);
    setSwitchMessage(null);
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function loadAccount() {
      const session = await loadCachedSession();
      if (!active) {
        return;
      }

      if (!session?.user.id) {
        setIsSignedIn(false);
        setProfile(null);
        setAccountLabel("Not signed in");
        setLoading(false);
        return;
      }

      setIsSignedIn(true);
      const metadata = session.user.user_metadata;
      const metadataName = typeof metadata?.full_name === "string" ? metadata.full_name : "";
      setSessionEmail(session.user.email ?? "");
      setFallbackName(metadataName || session.user.email?.split("@")[0] || "Guest");

      const supabase = createSupabaseBrowserClient();
      const [{ data: profileRow }, access] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
        loadCachedUserAccess(slug, session.user.id),
      ]);

      if (!active) {
        return;
      }

      const resolvedAccountType = (profileRow?.account_type ?? access.accountType ?? "").toLowerCase();
      const resolvedAccess = { ...access, accountType: resolvedAccountType || access.accountType };

      setProfile(profileRow ?? null);
      setAccountLabel(getAccountLabel(resolvedAccess));
      setIsParent(resolvedAccountType === "parent");
      setProfileForm({
        avatarUrl: profileRow?.avatar_url ?? "",
        fullName: profileRow?.full_name ?? metadataName ?? "",
        phone: profileRow?.phone_number ?? "",
        dateOfBirth: profileRow?.date_of_birth ?? "",
        email: profileRow?.email ?? session.user.email ?? "",
        password: "",
      });
      setCachedProfileSummary(session.user.id, {
        fullName: profileRow?.full_name?.trim() || metadataName || session.user.email?.split("@")[0] || null,
        avatarUrl: profileRow?.avatar_url?.trim() || null,
      });
      window.dispatchEvent(new Event("tareeqah:profile-name-changed"));
      setLoading(false);
    }

    void loadAccount();

    return () => {
      active = false;
    };
  }, [router, slug]);

  useEffect(() => {
    if (!canUseAccountSwitcher) {
      return;
    }

    let active = true;

    async function loadDevAccounts() {
      const fallbackAccounts = getDevSwitchAccounts();
      setDevSwitchAccounts(fallbackAccounts);

      const response = await fetch("/api/dev/accounts");
      const result = (await response.json()) as { accounts?: DevSwitchAccount[]; error?: string };
      if (!active) {
        return;
      }

      if (!response.ok) {
        setSwitchMessage(result.error ?? "Could not load development accounts.");
        return;
      }

      setDevSwitchAccounts(result.accounts?.length ? result.accounts : fallbackAccounts);
    }

    void loadDevAccounts().catch((loadError: unknown) => {
      if (active) {
        setSwitchMessage(loadError instanceof Error ? loadError.message : "Could not load development accounts.");
      }
    });

    return () => {
      active = false;
    };
  }, [canUseAccountSwitcher]);

  function handleLogout() {
    clearUserScopedCaches();
    setCachedSessionSnapshot(null);
    router.replace(`/m/${slug}/login`);
    void createSupabaseBrowserClient().auth.signOut();
  }

  async function switchAccount(account: DevSwitchAccount) {
    setSwitchBusy(true);
    setSwitchBusyEmail(account.email);
    setSwitchMessage(null);
    clearUserScopedCaches();
    setCachedSessionSnapshot(null);

    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    if (account.id && !account.password) {
      const response = await fetch("/api/dev/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: account.id, slug }),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        setSwitchMessage(result.error ?? `Could not switch to ${account.label}.`);
        setSwitchBusy(false);
        setSwitchBusyEmail(null);
        return;
      }

      window.location.href = result.url;
      return;
    }

    if (!account.password) {
      setSwitchMessage(`No switch method is available for ${account.label}.`);
      setSwitchBusy(false);
      setSwitchBusyEmail(null);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
    if (error || !data.user?.id) {
      setSwitchMessage(error?.message ?? `Could not switch to ${account.label}.`);
      setSwitchBusy(false);
      setSwitchBusyEmail(null);
      return;
    }

    saveDevSwitchAccount(account);

    const { data: profileRow } = await supabase.from("profiles").select("account_type").eq("id", data.user.id).maybeSingle();
    const access = await loadCachedUserAccess(slug, data.user.id);
    const accountType = (profileRow?.account_type ?? access.accountType ?? account.accountType).toLowerCase();
    const resolvedAccess = { ...access, accountType };

    const targetPath = getDefaultLandingHref(slug, resolvedAccess);
    router.replace(targetPath);
    router.refresh();
  }

  function openPanel(panel: AccountPanel) {
    setHasPanelNavigated(true);
    setPanelMotion("forward");
    setActivePanel(panel);
  }

  function closePanel() {
    setHasPanelNavigated(true);
    setPanelMotion("back");
    setActivePanel("menu");
    setEditingField(null);
    setProfileMessage(null);
    setSwitchMessage(null);
  }

  function openPhotoPanel() {
    setHasPanelNavigated(true);
    setPanelMotion("forward");
    setPhotoDraftUrl(profileForm.avatarUrl);
    setPhotoScale(1);
    setPhotoOffset({ x: 0, y: 0 });
    setProfileMessage(null);
    setActivePanel("photo");
  }

  function closePhotoPanel() {
    setHasPanelNavigated(true);
    setPanelMotion("back");
    setActivePanel("settings");
    setProfileMessage(null);
  }

  function handlePhotoFile(file: File | null) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPhotoDraftUrl(reader.result);
        setPhotoScale(1);
        setPhotoOffset({ x: 0, y: 0 });
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveAvatarUrl(nextAvatarUrl: string) {
    if (!profile?.id) {
      return;
    }

    setProfileSaving(true);
    setProfileMessage(null);
    const cleanedAvatarUrl = nextAvatarUrl.trim();
    const { data: updatedProfile, error } = await createSupabaseBrowserClient()
      .from("profiles")
      .update({
        avatar_url: cleanedAvatarUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .select("*")
      .maybeSingle();

    if (error || !updatedProfile) {
      setProfileMessage(error?.message ?? "Profile photo could not be saved. Please refresh and try again.");
      setProfileSaving(false);
      return;
    }

    setProfile(updatedProfile);
    setProfileForm((current) => ({ ...current, avatarUrl: updatedProfile.avatar_url ?? "" }));
    setCachedProfileSummary(profile.id, {
      fullName: updatedProfile.full_name?.trim() || null,
      avatarUrl: updatedProfile.avatar_url?.trim() || null,
    });
    window.dispatchEvent(new Event("tareeqah:profile-name-changed"));
    setProfileSaving(false);
    setProfileMessage(cleanedAvatarUrl ? "Profile photo updated." : "Profile photo removed.");
  }

  async function confirmPhotoChanges() {
    const croppedAvatarUrl = photoDraftUrl ? await cropAvatarImage(photoDraftUrl, photoScale, photoOffset).catch(() => photoDraftUrl) : "";
    await saveAvatarUrl(croppedAvatarUrl);
    setActivePanel("settings");
  }

  async function removeProfilePhoto() {
    setPhotoDraftUrl("");
    setPhotoScale(1);
    setPhotoOffset({ x: 0, y: 0 });
    await saveAvatarUrl("");
  }

  async function saveProfileField(field: EditableProfileField) {
    if (!profile?.id) {
      return;
    }

    setProfileSaving(true);
    setProfileMessage(null);
    const supabase = createSupabaseBrowserClient();

    if (field === "email" || field === "password") {
      const authUpdates: { email?: string; password?: string } = {};
      if (field === "email") {
        const nextEmail = profileForm.email.trim();
        if (!nextEmail) {
          setProfileMessage("Email cannot be empty.");
          setProfileSaving(false);
          return;
        }
        authUpdates.email = nextEmail;
      } else {
        const nextPassword = profileForm.password.trim();
        const passwordError = validateAccountPassword(nextPassword);
        if (passwordError) {
          setProfileMessage(passwordError);
          setProfileSaving(false);
          return;
        }
        authUpdates.password = nextPassword;
      }

      const { error } = await supabase.auth.updateUser(authUpdates);
      if (error) {
        setProfileMessage(error.message);
        setProfileSaving(false);
        return;
      }

      if (field === "email") {
        const nextEmail = profileForm.email.trim();
        const { data: updatedProfile, error: profileUpdateError } = await supabase
          .from("profiles")
          .update({ email: nextEmail, updated_at: new Date().toISOString() })
          .eq("id", profile.id)
          .select("*")
          .maybeSingle();
        if (profileUpdateError || !updatedProfile) {
          setProfileMessage(profileUpdateError?.message ?? "Email was changed for login, but the profile row did not update.");
          setProfileSaving(false);
          return;
        }
        setSessionEmail(nextEmail);
        setProfile(updatedProfile);
        setProfileForm((current) => ({ ...current, email: updatedProfile.email ?? nextEmail }));
      } else {
        setProfileForm((current) => ({ ...current, password: "" }));
      }
    } else {
      const updates =
        field === "fullName"
          ? { full_name: profileForm.fullName.trim() || null, updated_at: new Date().toISOString() }
          : field === "phone"
            ? { phone_number: profileForm.phone.trim() || null, updated_at: new Date().toISOString() }
            : { date_of_birth: profileForm.dateOfBirth || null, updated_at: new Date().toISOString() };

      const { data: updatedProfile, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", profile.id)
        .select("*")
        .maybeSingle();
      if (error || !updatedProfile) {
        setProfileMessage(error?.message ?? "Profile could not be saved. Please refresh and try again.");
        setProfileSaving(false);
        return;
      }

      setProfile(updatedProfile);
      setProfileForm((current) => ({
        ...current,
        fullName: updatedProfile.full_name ?? "",
        phone: updatedProfile.phone_number ?? "",
        dateOfBirth: updatedProfile.date_of_birth ?? "",
      }));

      if (field === "fullName") {
        setCachedProfileName(profile.id, updatedProfile.full_name?.trim() || null);
        setCachedProfileSummary(profile.id, {
          fullName: updatedProfile.full_name?.trim() || null,
          avatarUrl: updatedProfile.avatar_url?.trim() || null,
        });
        window.dispatchEvent(new Event("tareeqah:profile-name-changed"));
      }
    }

    setEditingField(null);
    setProfileMessage("Saved.");
    setProfileSaving(false);
  }

  const displayName = profile?.full_name?.trim() || fallbackName || "Guest";
  const displayEmail = profile?.email?.trim() || sessionEmail || "Not provided";
  const rawAccountType = profile?.account_type?.trim();
  const accountType = accountLabel === "Account" && rawAccountType ? `${titleCase(rawAccountType)} Account` : accountLabel;

  if (loading) {
    return <GenericLoadingState label="Loading account" />;
  }

  if (!isSignedIn) {
    return (
      <section className="min-h-[calc(100vh-140px)] bg-[var(--workspace)] px-5 py-10 text-[#26323A]">
        <div className="mx-auto max-w-sm">
          <div className="rounded-[30px] bg-white p-8 text-center shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#79B7C8] text-3xl font-semibold text-[#2F8FB3]">!</div>
            <h1 className="mt-6 text-2xl font-semibold text-[#26323A]">Log in required</h1>
            <p className="mt-2 text-sm leading-6 text-[#6B747B]">Your account page is available after signing in.</p>
            <Link href={`/m/${slug}/login`} className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-[#26323A] px-7 text-sm font-semibold !text-white shadow-[0_12px_24px_rgba(38,50,58,0.18)]">
              Log in
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const accountPanels: Record<AccountPanel, ReactNode> = {
    menu: (
      <>
        <div className="flex flex-col items-center pt-3 text-center">
          <AccountAvatar src={profile?.avatar_url ?? null} name={displayName} />
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.01em] text-[#1F2A31]">{displayName}</h1>
          <p className="mt-1 text-sm font-medium text-[#6B747B]">{accountType}</p>
        </div>

        <nav className="mt-10 -mx-5 divide-y divide-[#E3E8EC] px-5">
          <AccountMenuButton icon={<AccountUserIcon />} label="Account Settings" onClick={() => openPanel("settings")} />
          {isParent ? <AccountMenuButton icon={<FamilyIcon />} label="Family" onClick={() => openPanel("family")} /> : null}
          <AccountMenuButton icon={<BillingIcon />} label="Billing" onClick={() => openPanel("billing")} />
          <AccountMenuButton icon={<ShieldIcon />} label="Privacy and Security" onClick={() => openPanel("security")} />
          <AccountMenuButton icon={<HomeScreenIcon />} label="Add App to Homescreen" onClick={() => openPanel("homescreen")} />
          <AccountMenuButton icon={<LogoutIcon />} label="Log out" tone="danger" onClick={handleLogout} />
          {canUseAccountSwitcher ? <AccountMenuButton icon={<SwitchAccountIcon />} label="Switch Account" onClick={() => openPanel("switchAccount")} /> : null}
        </nav>
      </>
    ),
    settings: (
      <>
        <AccountSubpageHeader title="Account Settings" onBack={closePanel} />
        <div className="mt-8">
          <div className="-mx-1 flex items-center gap-4 border-b border-[#E3E8EC] px-1 pb-7">
            <AccountAvatar src={profile?.avatar_url ?? null} name={displayName} size="sm" />
            <button type="button" onClick={openPhotoPanel} className="min-h-10 rounded-full bg-[#F2F4F5] px-5 text-sm font-semibold text-[#26323A]">
              Edit photo
            </button>
            <button type="button" onClick={removeProfilePhoto} disabled={profileSaving} className="min-h-10 rounded-full bg-[#FCEDEC] px-5 text-sm font-semibold text-[#8F2D23] disabled:opacity-60">
              Remove
            </button>
          </div>

          <section className="mt-7">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8A9399]">Personal details</p>
            <div className="mt-2 divide-y divide-[#E6EAED]">
              <EditableProfileRow
                label="Full name"
                value={profileForm.fullName || "Not provided"}
                editValue={profileForm.fullName}
                editing={editingField === "fullName"}
                onEdit={() => setEditingField("fullName")}
                onChange={(value) => setProfileForm((current) => ({ ...current, fullName: value }))}
                onSave={() => saveProfileField("fullName")}
                saving={profileSaving}
              />
              <EditableProfileRow
                label="Password"
                value="************"
                editValue={profileForm.password}
                inputType="password"
                placeholder="New password"
                editing={editingField === "password"}
                onEdit={() => setEditingField("password")}
                onChange={(value) => setProfileForm((current) => ({ ...current, password: value }))}
                onSave={() => saveProfileField("password")}
                saving={profileSaving}
              />
              <EditableProfileRow
                label="Email address"
                value={profileForm.email || displayEmail}
                editValue={profileForm.email}
                inputType="email"
                editing={editingField === "email"}
                onEdit={() => setEditingField("email")}
                onChange={(value) => setProfileForm((current) => ({ ...current, email: value }))}
                onSave={() => saveProfileField("email")}
                saving={profileSaving}
              />
              <EditableProfileRow
                label="Date of birth"
                value={profileForm.dateOfBirth || "Not provided"}
                editValue={profileForm.dateOfBirth}
                inputType="date"
                editing={editingField === "dateOfBirth"}
                onEdit={() => setEditingField("dateOfBirth")}
                onChange={(value) => setProfileForm((current) => ({ ...current, dateOfBirth: value }))}
                onSave={() => saveProfileField("dateOfBirth")}
                saving={profileSaving}
              />
              <EditableProfileRow
                label="Phone number"
                value={profileForm.phone || "Not provided"}
                editValue={profileForm.phone}
                inputMode="tel"
                editing={editingField === "phone"}
                onEdit={() => setEditingField("phone")}
                onChange={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
                onSave={() => saveProfileField("phone")}
                saving={profileSaving}
              />
            </div>
          </section>

          {profileMessage ? <p className="mt-5 rounded-2xl bg-[#F0F8FB] px-4 py-3 text-sm leading-6 text-[#257B9C]">{profileMessage}</p> : null}
        </div>
      </>
    ),
    photo: (
      <EditProfilePhotoPanel
        previewUrl={photoDraftUrl || profile?.avatar_url || ""}
        name={displayName}
        scale={photoScale}
        offset={photoOffset}
        saving={profileSaving}
        fileInputRef={photoInputRef}
        onBack={closePhotoPanel}
        onScaleChange={setPhotoScale}
        onOffsetChange={setPhotoOffset}
        onFileChange={handlePhotoFile}
        onConfirm={confirmPhotoChanges}
      />
    ),
    switchAccount: (
      <>
        <AccountSubpageHeader title="Switch Account" onBack={closePanel} />
        <AccountSwitchPanel
          accounts={devSwitchAccounts}
          busy={switchBusy}
          busyEmail={switchBusyEmail}
          message={switchMessage}
          onSwitch={switchAccount}
        />
      </>
    ),
    family: (
      <>
        <AccountSubpageHeader title="Family" onBack={closePanel} />
        <div className="mt-8">
          <ChildrenManager slug={slug} />
        </div>
      </>
    ),
    billing: (
      <>
        <AccountSubpageHeader title="Billing" onBack={closePanel} />
        <div className="mt-8 space-y-7">
          <StaticAccountNote title="Payments" text="Stripe billing and receipts will be connected here later." />
          <AccountDetailGroup>
            <AccountDetailRow label="Payment Method" value="Not added" />
            <AccountDetailRow label="Active Plans" value="No paid plans yet" />
          </AccountDetailGroup>
        </div>
      </>
    ),
    security: (
      <>
        <AccountSubpageHeader title="Privacy and Security" onBack={closePanel} />
        <div className="mt-8">
          <StaticAccountNote title="Privacy controls" text="Privacy and security settings will be added here later." />
        </div>
      </>
    ),
    homescreen: (
      <>
        <AccountSubpageHeader title="Add App to Homescreen" onBack={closePanel} />
        <div className="mt-8 space-y-5">
          <StaticAccountNote
            title="Install Tareeqah"
            text="Tareeqah works as a progressive web app. It opens like a normal app from your home screen, but it still updates through the website."
          />
          <AccountDetailGroup>
            <AccountDetailRow label="iPhone or iPad" value="Open Safari, tap Share, then choose Add to Home Screen." />
            <AccountDetailRow label="Android" value="Open Chrome, tap the menu, then choose Install app or Add to Home screen." />
            <AccountDetailRow label="Note" value="Use your browser install option. The app will not appear in the App Store or Play Store." />
          </AccountDetailGroup>
        </div>
      </>
    ),
  };

  const mobilePanel = activePanel;
  const desktopPanel = activePanel === "menu" ? "settings" : activePanel;

  function renderAccountPanel(panel: AccountPanel) {
    return (
      <div
        key={panel}
        className={cn(
          hasPanelNavigated ? "account-panel-slide" : "",
          hasPanelNavigated && (panelMotion === "forward" ? "account-panel-slide-forward" : "account-panel-slide-back"),
        )}
      >
        <AccountPanelFrame>{accountPanels[panel]}</AccountPanelFrame>
      </div>
    );
  }

  return (
    <section className="min-h-[calc(100vh-140px)] overflow-hidden bg-[var(--workspace)] px-5 py-8 text-[#26323A]">
      <div className="mx-auto max-w-sm overflow-hidden md:hidden">
        {renderAccountPanel(mobilePanel)}
      </div>
      <div className="mx-auto hidden max-w-lg overflow-hidden md:block">
        {renderAccountPanel(desktopPanel)}
      </div>
    </section>
  );
}

function isAccountPanel(value: string): value is AccountPanel {
  return value === "menu" || value === "settings" || value === "family" || value === "billing" || value === "security" || value === "homescreen" || value === "photo" || value === "switchAccount";
}

export function InboxAnnouncementsData({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [announcements, setAnnouncements] = useState<AnnouncementWithContext[]>([]);
  const [enrolledProgramsForInbox, setEnrolledProgramsForInbox] = useState<Program[]>([]);
  const [notes, setNotes] = useState<StudentNoteWithContext[]>([]);
  const [requests, setRequests] = useState<RequestWithContext[]>([]);
  const [studentWithdrawals, setStudentWithdrawals] = useState<WithdrawalRequestWithContext[]>([]);
  const initialInboxTab = searchParams.get("tab");
  const [tab, setTab] = useState<"announcements" | "notes" | "requests">(initialInboxTab === "notes" || initialInboxTab === "requests" ? initialInboxTab : "announcements");
  const [selectedThread, setSelectedThread] = useState<StudentInboxThread | null>(null);
  const [announcementTrackIdsByProgramId, setAnnouncementTrackIdsByProgramId] = useState<Record<string, string[]>>({});
  const [announcementThreadExhausted, setAnnouncementThreadExhausted] = useState<Record<string, boolean>>({});
  const [announcementThreadLoadingOlder, setAnnouncementThreadLoadingOlder] = useState<Record<string, boolean>>({});
  const [noteThreadExhausted, setNoteThreadExhausted] = useState<Record<string, boolean>>({});
  const [noteThreadLoadingOlder, setNoteThreadLoadingOlder] = useState<Record<string, boolean>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<"success" | "cancelled" | null>(null);
  const [protectedClear, setProtectedClear] = useState<{ mode: "single" | "all"; requestIds: string[]; count: number } | null>(null);
  const [rescindTarget, setRescindTarget] = useState<RequestWithContext | null>(null);
  const [rescindBusy, setRescindBusy] = useState(false);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inboxDeepLinkHandledRef = useRef<string | null>(null);

  useEffect(() => {
    const payment = searchParams.get("payment");
    const checkoutSessionId = searchParams.get("session_id");
    if (payment === "success" || payment === "cancelled") {
      router.replace(`/m/${slug}/portal/announcements`);
      if (payment === "success") {
        void confirmCheckoutPayment(checkoutSessionId);
      } else {
        setPaymentNotice("cancelled");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, searchParams, slug]);

  async function confirmCheckoutPayment(checkoutSessionId: string | null) {
    if (!checkoutSessionId) {
      setError("Payment succeeded, but Stripe did not return a checkout session.");
      return;
    }

    setPaymentConfirming(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setPaymentConfirming(false);
      setError("Payment succeeded. Please sign in again to finish registration.");
      return;
    }

    const response = await fetch("/api/stripe/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    setPaymentConfirming(false);

    if (!response.ok || !payload.ok) {
      setError(payload.error ?? "Payment succeeded, but registration could not be completed.");
      return;
    }

    setPaymentNotice("success");
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
  }

  async function loadInbox() {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setCurrentUserId(null);
      setSeenRequestIds(new Set());
      setAnnouncements([]);
      setEnrolledProgramsForInbox([]);
      setAnnouncementTrackIdsByProgramId({});
      setAnnouncementThreadExhausted({});
      setAnnouncementThreadLoadingOlder({});
      setNoteThreadExhausted({});
      setNoteThreadLoadingOlder({});
      setNotes([]);
      setRequests([]);
      setStudentWithdrawals([]);
      setLoading(false);
      return;
    }

    setCurrentUserId(userId);
    setSeenRequestIds(readSeenNotificationIds(seenStudentRequestsStorageKey, userId));

    const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (!mosque) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle();
    const isParent = profile?.account_type === "parent";
    const { children } = isParent ? await fetchParentChildren(supabase, slug, userId, mosque.id) : { children: [] as StudentDisplay[] };
    const targetStudentIds = isParent ? children.map((child) => child.id) : [userId];

    const [{ data: enrollments }, { data: requestRows, error: requestError }, { data: withdrawalRows, error: withdrawalError }] = await Promise.all([
      targetStudentIds.length
        ? supabase.from("enrollments").select("id, program_id, student_profile_id, program_track_id").in("student_profile_id", targetStudentIds)
        : Promise.resolve({ data: [] as EnrollmentTrackSelection[] }),
      isParent
        ? supabase
            .from("enrollment_requests")
            .select("*")
            .eq("mosque_id", mosque.id)
            .eq("parent_profile_id", userId)
            .is("student_dismissed_at", null)
            .order("requested_at", { ascending: false })
        : supabase
            .from("enrollment_requests")
            .select("*")
            .eq("mosque_id", mosque.id)
            .eq("student_profile_id", userId)
            .is("student_dismissed_at", null)
            .order("requested_at", { ascending: false }),
      isParent
        ? supabase
            .from("withdrawal_requests")
            .select("*")
            .eq("mosque_id", mosque.id)
            .or(`parent_profile_id.eq.${userId},requested_by.eq.${userId}`)
            .is("student_dismissed_at", null)
            .order("requested_at", { ascending: false })
        : supabase
            .from("withdrawal_requests")
            .select("*")
            .eq("mosque_id", mosque.id)
            .eq("student_profile_id", userId)
            .is("student_dismissed_at", null)
            .order("requested_at", { ascending: false }),
    ]);

    if (requestError || withdrawalError) {
      setLoading(false);
      setError(requestError?.message ?? withdrawalError?.message ?? "Could not load inbox.");
      return;
    }

    const enrollmentRows = (enrollments ?? []) as EnrollmentTrackSelection[];
    const enrollmentIds = enrollmentRows.map((enrollment) => enrollment.id);
    const { data: enrollmentTrackRows } = enrollmentIds.length
      ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
      : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };
    const enrolledTrackIdsByProgramId = getEnrollmentTrackIdsByProgram(enrollmentRows, enrollmentTrackRows ?? []);
    setAnnouncementTrackIdsByProgramId(
      Object.fromEntries(Array.from(enrolledTrackIdsByProgramId.entries()).map(([programId, trackIds]) => [programId, Array.from(trackIds)])),
    );

    const enrolledProgramIds = enrollmentRows.map((enrollment) => enrollment.program_id);
    const noteThreadKeys = Array.from(new Set(enrollmentRows.map((enrollment) => `${enrollment.program_id}:${enrollment.student_profile_id}`)));
    const noteQueries = await Promise.all(
      noteThreadKeys.map(async (key) => {
        const [programId, studentId] = key.split(":");
        const { data: rows, error: noteError } = await supabase
          .from("program_student_notes")
          .select("*")
          .eq("program_id", programId)
          .eq("student_profile_id", studentId)
          .order("created_at", { ascending: false })
          .limit(NOTE_THREAD_PAGE_SIZE);
        return { key, rows: rows ?? [], error: noteError };
      }),
    );
    const noteError = noteQueries.find((result) => result.error)?.error;
    if (noteError) {
      setLoading(false);
      setError(noteError.message);
      return;
    }
    setNoteThreadExhausted(Object.fromEntries(noteQueries.map((result) => [result.key, result.rows.length < NOTE_THREAD_PAGE_SIZE])));
    setNoteThreadLoadingOlder({});
    const noteRows = noteQueries.flatMap((result) => result.rows);
    const requestProgramIds = (requestRows ?? []).map((request) => request.program_id);
    const withdrawalProgramIds = (withdrawalRows ?? []).map((request) => request.program_id);
    const noteProgramIds = noteRows.map((note) => note.program_id);
    const knownProgramIds = Array.from(new Set([...enrolledProgramIds, ...requestProgramIds, ...withdrawalProgramIds, ...noteProgramIds]));
    const requestStudentIds = Array.from(new Set((requestRows ?? []).map((request) => request.student_profile_id)));
    const withdrawalStudentIds = Array.from(new Set((withdrawalRows ?? []).map((request) => request.student_profile_id)));
    const noteStudentIds = Array.from(new Set(noteRows.map((note) => note.student_profile_id)));
    const [{ data: programs }, { data: requestStudents }, { data: noteStudents }] = await Promise.all([
      knownProgramIds.length ? supabase.from("programs").select("*").in("id", knownProgramIds) : Promise.resolve({ data: [] as Program[] }),
      [...requestStudentIds, ...withdrawalStudentIds].length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type").in("id", Array.from(new Set([...requestStudentIds, ...withdrawalStudentIds])))
        : Promise.resolve({ data: [] as StudentDisplay[] }),
      noteStudentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type").in("id", noteStudentIds)
        : Promise.resolve({ data: [] as StudentDisplay[] }),
    ]);
    const childProfiles = isParent ? [...children, ...((requestStudents ?? []) as StudentDisplay[])] : ((requestStudents ?? []) as StudentDisplay[]);
    const enrolledProgramSet = new Set(enrolledProgramIds);
    setEnrolledProgramsForInbox((programs ?? []).filter((program) => enrolledProgramSet.has(program.id)));

    setRequests(
      (requestRows ?? []).map((request) => ({
        ...request,
        program: (programs ?? []).find((program) => program.id === request.program_id) ?? null,
        student: childProfiles.find((student) => student.id === request.student_profile_id) ?? null,
      })),
    );
    setStudentWithdrawals(
      (withdrawalRows ?? []).map((request) => ({
        ...request,
        program: (programs ?? []).find((program) => program.id === request.program_id) ?? null,
        student: childProfiles.find((student) => student.id === request.student_profile_id) ?? null,
      })),
    );

    const noteAuthorIds = Array.from(new Set(noteRows.map((note) => note.author_profile_id)));
    const noteRecipientIds = Array.from(new Set(noteRows.map((note) => note.recipient_profile_id)));
    const [{ data: noteAuthors }, { data: noteRecipients }] = await Promise.all([
      noteAuthorIds.length ? supabase.from("profiles").select("*").in("id", noteAuthorIds) : Promise.resolve({ data: [] as Profile[] }),
      noteRecipientIds.length ? supabase.from("profiles").select("*").in("id", noteRecipientIds) : Promise.resolve({ data: [] as Profile[] }),
    ]);
    const studentProfiles = [...childProfiles, ...((noteStudents ?? []) as StudentDisplay[])];
    setNotes(
      noteRows.map((note) => ({
        ...note,
        program: (programs ?? []).find((program) => program.id === note.program_id) ?? null,
        student: studentProfiles.find((student) => student.id === note.student_profile_id) ?? null,
        recipient: (noteRecipients ?? []).find((recipient) => recipient.id === note.recipient_profile_id) ?? null,
        author: (noteAuthors ?? []).find((author) => author.id === note.author_profile_id) ?? null,
      })),
    );

    if (enrolledProgramIds.length === 0) {
      setAnnouncements([]);
      setEnrolledProgramsForInbox([]);
      setAnnouncementThreadExhausted({});
      setAnnouncementThreadLoadingOlder({});
      setNoteThreadExhausted({});
      setNoteThreadLoadingOlder({});
      setLoading(false);
      return;
    }

    const announcementQueries = await Promise.all(
      Array.from(new Set(enrolledProgramIds)).map(async (programId) => {
        const { data: rows, error: queryError } = await supabase
          .from("program_announcements")
          .select("*")
          .eq("program_id", programId)
          .order("created_at", { ascending: false })
          .limit(ANNOUNCEMENT_THREAD_PAGE_SIZE);
        return { programId, rows: rows ?? [], error: queryError };
      }),
    );
    const queryError = announcementQueries.find((result) => result.error)?.error;
    if (queryError) {
      setLoading(false);
      setError(queryError.message);
      return;
    }
    setAnnouncementThreadExhausted(
      Object.fromEntries(announcementQueries.map((result) => [result.programId, result.rows.length < ANNOUNCEMENT_THREAD_PAGE_SIZE])),
    );
    setAnnouncementThreadLoadingOlder({});

    const announcementRows = announcementQueries.flatMap((result) => result.rows);
    const announcementIds = announcementRows.map((announcement) => announcement.id);
    const authorIds = Array.from(new Set(announcementRows.map((announcement) => announcement.author_profile_id).filter(Boolean)));
    const [{ data: authors }, { data: receipts }] = await Promise.all([
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      announcementIds.length
        ? supabase.from("program_announcement_receipts").select("*").eq("profile_id", userId).in("announcement_id", announcementIds)
        : Promise.resolve({ data: [] as AnnouncementReceipt[] }),
    ]);

    const visibleAnnouncements = announcementRows
      .map((announcement) => ({
        ...announcement,
        program: (programs ?? []).find((program) => program.id === announcement.program_id) ?? null,
        author: (authors ?? []).find((author) => author.id === announcement.author_profile_id) ?? null,
        receipt: (receipts ?? []).find((receipt) => receipt.announcement_id === announcement.id) ?? null,
      }))
      .filter((announcement) => isAnnouncementVisibleForEnrollment(announcement, enrolledTrackIdsByProgramId.get(announcement.program_id)))
      .filter((announcement) => !announcement.receipt?.dismissed_at);

    setAnnouncements(visibleAnnouncements);
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInbox();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function dismissRequests(requestIds: string[]) {
    if (!requestIds.length) {
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error: dismissError } = await supabase
      .from("enrollment_requests")
      .update({ student_dismissed_at: new Date().toISOString() })
      .in("id", requestIds);
    if (dismissError) {
      setError(dismissError.message);
      return;
    }
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
  }

  async function dismissWithdrawalRequests(requestIds: string[]) {
    if (!requestIds.length) {
      return;
    }
    const { error: dismissError } = await createSupabaseBrowserClient()
      .from("withdrawal_requests")
      .update({ student_dismissed_at: new Date().toISOString() })
      .in("id", requestIds);
    if (dismissError) {
      setError(dismissError.message);
      return;
    }
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
  }

  async function updateRequest(requestId: string, action: "rescind" | "dismiss") {
    if (action === "dismiss") {
      const request = requests.find((item) => item.id === requestId);
      if (request && hasIncompletePaidApproval(request)) {
        setProtectedClear({ mode: "single", requestIds: [requestId], count: 1 });
        return;
      }
      await dismissRequests([requestId]);
      return;
    }

    const { error: rescindError } = await createSupabaseBrowserClient()
      .from("enrollment_requests")
      .update({ status: "cancelled", student_dismissed_at: new Date().toISOString() })
      .eq("id", requestId);

    if (rescindError) {
      setError(rescindError.message);
      return;
    }

    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
  }

  async function confirmRescindRequest() {
    if (!rescindTarget) {
      return;
    }

    setRescindBusy(true);
    const { error: rescindError } = await createSupabaseBrowserClient()
      .from("enrollment_requests")
      .update({ status: "cancelled", student_dismissed_at: new Date().toISOString() })
      .eq("id", rescindTarget.id);

    if (rescindError) {
      setRescindBusy(false);
      setError(rescindError.message);
      return;
    }

    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
    setRescindBusy(false);
    setRescindTarget(null);
    setToast({ tone: "success", message: "Application rescinded." });
  }

  async function clearAllReturnedRequests() {
    const returnedRequestIds = returnedRequests.map((request) => request.id);
    const returnedWithdrawalIds = returnedWithdrawals.map((request) => request.id);
    if (!returnedRequestIds.length && !returnedWithdrawalIds.length) {
      return;
    }
    const protectedRequests = returnedRequests.filter(hasIncompletePaidApproval);
    if (protectedRequests.length) {
      setProtectedClear({ mode: "all", requestIds: returnedRequestIds, count: protectedRequests.length });
      return;
    }

    await dismissRequests(returnedRequestIds);
    await dismissWithdrawalRequests(returnedWithdrawalIds);
  }

  async function startCheckout(requestId: string) {
    setCheckoutRequestId(requestId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setError("Please sign in again before completing registration.");
      setCheckoutRequestId(null);
      return;
    }

    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ enrollmentRequestId: requestId }),
    });
    const payload = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      setError(payload.error ?? "Could not start checkout.");
      setCheckoutRequestId(null);
      return;
    }

    window.location.href = payload.url;
  }

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const returnedRequests = requests.filter((request) => request.status !== "pending");
  const pendingWithdrawals = studentWithdrawals.filter((request) => request.status === "pending");
  const returnedWithdrawals = studentWithdrawals.filter((request) => request.status !== "pending");
  const unseenReturnedRequestCount =
    returnedRequests.filter((request) => !seenRequestIds.has(studentRequestNotificationKey(request))).length +
    returnedWithdrawals.filter((request) => !seenRequestIds.has(studentWithdrawalNotificationKey(request))).length;
  const returnedRequestIdsKey = [
    ...returnedRequests.map(studentRequestNotificationKey),
    ...returnedWithdrawals.map(studentWithdrawalNotificationKey),
  ].join("|");
  const announcementThreads = buildAnnouncementThreads(announcements, enrolledProgramsForInbox);
  const noteThreads = buildNoteThreads(notes);
  const unreadAnnouncementCount = announcements.filter((announcement) => !announcement.receipt?.read_at).length;
  const unreadNoteCount = notes.filter((note) => !note.seen_at).length;

  useEffect(() => {
    if (!loading && tab === "requests" && returnedRequestIdsKey) {
      setSeenRequestIds(markNotificationIdsSeen(seenStudentRequestsStorageKey, currentUserId, returnedRequestIdsKey.split("|")));
    }
  }, [currentUserId, loading, returnedRequestIdsKey, tab]);

  function changeTab(nextTab: "announcements" | "notes" | "requests") {
    setTab(nextTab);
    setSelectedThread(null);
    if (nextTab === "requests") {
      setSeenRequestIds(markNotificationIdsSeen(seenStudentRequestsStorageKey, currentUserId, [
        ...returnedRequests.map(studentRequestNotificationKey),
        ...returnedWithdrawals.map(studentWithdrawalNotificationKey),
      ]));
    }
  }

  useEffect(() => {
    if (loading || selectedThread) {
      return;
    }

    const requestedTab = searchParams.get("tab");
    const programId = searchParams.get("programId");
    if (requestedTab !== "announcements" && requestedTab !== "notes" && requestedTab !== "requests") {
      return;
    }

    const key = `${requestedTab}:${programId ?? ""}`;
    if (inboxDeepLinkHandledRef.current === key) {
      return;
    }

    inboxDeepLinkHandledRef.current = key;
    changeTab(requestedTab);
    if (requestedTab === "announcements" && programId) {
      void openThread({ kind: "announcements", programId });
    }
    if (requestedTab === "notes" && programId) {
      const targetNote = notes.find((note) => note.program_id === programId);
      if (targetNote) {
        void openThread({ kind: "notes", programId, studentId: targetNote.student_profile_id });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, loading, notes, searchParams, selectedThread]);

  async function openThread(thread: StudentInboxThread) {
    setSelectedThread(thread);
    const supabase = createSupabaseBrowserClient();
    const now = new Date().toISOString();

    if (thread.kind === "announcements" && currentUserId) {
      const threadAnnouncements = announcements.filter((announcement) => announcement.program_id === thread.programId && !announcement.receipt?.read_at);
      if (threadAnnouncements.length) {
        await supabase.from("program_announcement_receipts").upsert(
          threadAnnouncements.map((announcement) => ({
            announcement_id: announcement.id,
            profile_id: currentUserId,
            read_at: now,
            dismissed_at: null,
            updated_at: now,
          })),
          { onConflict: "announcement_id,profile_id" },
        );
        setAnnouncements((current) =>
          current.map((announcement) =>
            announcement.program_id === thread.programId
              ? {
                  ...announcement,
                  receipt: {
                    id: announcement.receipt?.id ?? `local-${announcement.id}`,
                    announcement_id: announcement.id,
                    profile_id: currentUserId,
                    read_at: now,
                    dismissed_at: null,
                    created_at: announcement.receipt?.created_at ?? now,
                    updated_at: now,
                  },
                }
              : announcement,
          ),
        );
      }
    }

    if (thread.kind === "notes") {
      const unreadIds = notes.filter((note) => note.program_id === thread.programId && note.student_profile_id === thread.studentId && !note.seen_at).map((note) => note.id);
      if (unreadIds.length) {
        await supabase.rpc("mark_program_student_notes_seen", { note_ids: unreadIds });
        setNotes((current) =>
          current.map((note) => (unreadIds.includes(note.id) ? { ...note, seen_at: now, seen_by: currentUserId, updated_at: now } : note)),
        );
      }
    }

    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  async function loadOlderAnnouncements(programId: string) {
    if (!currentUserId || announcementThreadLoadingOlder[programId] || announcementThreadExhausted[programId]) {
      return;
    }

    const currentProgramAnnouncements = announcements
      .filter((announcement) => announcement.program_id === programId)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const oldestLoadedAt = currentProgramAnnouncements[0]?.created_at;
    if (!oldestLoadedAt) {
      return;
    }

    setAnnouncementThreadLoadingOlder((current) => ({ ...current, [programId]: true }));
    const supabase = createSupabaseBrowserClient();
    const { data: olderRows, error: olderError } = await supabase
      .from("program_announcements")
      .select("*")
      .eq("program_id", programId)
      .lt("created_at", oldestLoadedAt)
      .order("created_at", { ascending: false })
      .limit(ANNOUNCEMENT_THREAD_PAGE_SIZE);

    if (olderError) {
      setAnnouncementThreadLoadingOlder((current) => ({ ...current, [programId]: false }));
      setError(olderError.message);
      return;
    }

    const announcementIds = (olderRows ?? []).map((announcement) => announcement.id);
    const authorIds = Array.from(new Set((olderRows ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean)));
    const [{ data: authors }, { data: receipts }] = await Promise.all([
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      announcementIds.length
        ? supabase.from("program_announcement_receipts").select("*").eq("profile_id", currentUserId).in("announcement_id", announcementIds)
        : Promise.resolve({ data: [] as AnnouncementReceipt[] }),
    ]);

    const enrolledTrackIds = new Set(announcementTrackIdsByProgramId[programId] ?? []);
    const program = enrolledProgramsForInbox.find((item) => item.id === programId) ?? null;
    const now = new Date().toISOString();
    const visibleOlderAnnouncements = (olderRows ?? [])
      .map((announcement) => ({
        ...announcement,
        program,
        author: (authors ?? []).find((author) => author.id === announcement.author_profile_id) ?? null,
        receipt: (receipts ?? []).find((receipt) => receipt.announcement_id === announcement.id) ?? null,
      }))
      .filter((announcement) => isAnnouncementVisibleForEnrollment(announcement, enrolledTrackIds))
      .filter((announcement) => !announcement.receipt?.dismissed_at)
      .map((announcement) => ({
        ...announcement,
        receipt: {
          id: announcement.receipt?.id ?? `local-${announcement.id}`,
          announcement_id: announcement.id,
          profile_id: currentUserId,
          read_at: now,
          dismissed_at: null,
          created_at: announcement.receipt?.created_at ?? now,
          updated_at: now,
        },
      }));

    if (visibleOlderAnnouncements.length) {
      await supabase.from("program_announcement_receipts").upsert(
        visibleOlderAnnouncements.map((announcement) => ({
          announcement_id: announcement.id,
          profile_id: currentUserId,
          read_at: now,
          dismissed_at: null,
          updated_at: now,
        })),
        { onConflict: "announcement_id,profile_id" },
      );
    }

    setAnnouncements((current) => {
      const existingIds = new Set(current.map((announcement) => announcement.id));
      return [...current, ...visibleOlderAnnouncements.filter((announcement) => !existingIds.has(announcement.id))];
    });
    setAnnouncementThreadExhausted((current) => ({
      ...current,
      [programId]: (olderRows ?? []).length < ANNOUNCEMENT_THREAD_PAGE_SIZE,
    }));
    setAnnouncementThreadLoadingOlder((current) => ({ ...current, [programId]: false }));
  }

  async function loadOlderNotes(programId: string, studentId: string) {
    const threadKey = `${programId}:${studentId}`;
    if (!currentUserId || noteThreadLoadingOlder[threadKey] || noteThreadExhausted[threadKey]) {
      return;
    }

    const currentThreadNotes = notes
      .filter((note) => note.program_id === programId && note.student_profile_id === studentId)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const oldestLoadedAt = currentThreadNotes[0]?.created_at;
    if (!oldestLoadedAt) {
      return;
    }

    setNoteThreadLoadingOlder((current) => ({ ...current, [threadKey]: true }));
    const supabase = createSupabaseBrowserClient();
    const { data: olderRows, error: olderError } = await supabase
      .from("program_student_notes")
      .select("*")
      .eq("program_id", programId)
      .eq("student_profile_id", studentId)
      .lt("created_at", oldestLoadedAt)
      .order("created_at", { ascending: false })
      .limit(NOTE_THREAD_PAGE_SIZE);

    if (olderError) {
      setNoteThreadLoadingOlder((current) => ({ ...current, [threadKey]: false }));
      setError(olderError.message);
      return;
    }

    const authorIds = Array.from(new Set((olderRows ?? []).map((note) => note.author_profile_id)));
    const recipientIds = Array.from(new Set((olderRows ?? []).map((note) => note.recipient_profile_id)));
    const [{ data: authors }, { data: recipients }] = await Promise.all([
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      recipientIds.length ? supabase.from("profiles").select("*").in("id", recipientIds) : Promise.resolve({ data: [] as Profile[] }),
    ]);

    const now = new Date().toISOString();
    const olderNoteIds = (olderRows ?? []).filter((note) => !note.seen_at).map((note) => note.id);
    if (olderNoteIds.length) {
      await supabase.rpc("mark_program_student_notes_seen", { note_ids: olderNoteIds });
    }

    const program = enrolledProgramsForInbox.find((item) => item.id === programId) ?? null;
    const student = notes.find((note) => note.program_id === programId && note.student_profile_id === studentId)?.student ?? null;
    const visibleOlderNotes = (olderRows ?? []).map((note) => ({
      ...note,
      program,
      student,
      recipient: (recipients ?? []).find((recipient) => recipient.id === note.recipient_profile_id) ?? null,
      author: (authors ?? []).find((author) => author.id === note.author_profile_id) ?? null,
      seen_at: note.seen_at ?? now,
      seen_by: note.seen_by ?? currentUserId,
      updated_at: now,
    }));

    setNotes((current) => {
      const existingIds = new Set(current.map((note) => note.id));
      return [...current, ...visibleOlderNotes.filter((note) => !existingIds.has(note.id))];
    });
    setNoteThreadExhausted((current) => ({ ...current, [threadKey]: (olderRows ?? []).length < NOTE_THREAD_PAGE_SIZE }));
    setNoteThreadLoadingOlder((current) => ({ ...current, [threadKey]: false }));
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  return (
    <div className="bg-[var(--workspace)]">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <div className="md:hidden">
        <FloatingInboxTabs
          tabs={[
            { id: "announcements", label: "Announcements", badge: unreadAnnouncementCount },
            { id: "notes", label: "Notes", badge: unreadNoteCount },
            { id: "requests", label: "Applications", badge: unseenReturnedRequestCount },
          ]}
          value={tab}
          onChange={(value) => changeTab(value as "announcements" | "notes" | "requests")}
        />
      </div>
      <div className="space-y-4 p-4">
        {error ? (
          <EmptyState title="Could not load inbox" text={error} />
        ) : loading ? (
          <InboxLoadingPanel label={tab === "announcements" ? "Loading announcements" : tab === "notes" ? "Loading notes" : "Loading applications"} />
        ) : selectedThread ? (
          <StudentInboxThreadView
            thread={selectedThread}
            announcements={announcements}
            notes={notes}
            hasOlderAnnouncements={selectedThread.kind === "announcements" ? !announcementThreadExhausted[selectedThread.programId] : false}
            loadingOlderAnnouncements={selectedThread.kind === "announcements" ? Boolean(announcementThreadLoadingOlder[selectedThread.programId]) : false}
            onLoadOlderAnnouncements={selectedThread.kind === "announcements" ? () => void loadOlderAnnouncements(selectedThread.programId) : undefined}
            hasOlderNotes={selectedThread.kind === "notes" ? !noteThreadExhausted[`${selectedThread.programId}:${selectedThread.studentId}`] : false}
            loadingOlderNotes={selectedThread.kind === "notes" ? Boolean(noteThreadLoadingOlder[`${selectedThread.programId}:${selectedThread.studentId}`]) : false}
            onLoadOlderNotes={selectedThread.kind === "notes" ? () => void loadOlderNotes(selectedThread.programId, selectedThread.studentId) : undefined}
            onBack={() => setSelectedThread(null)}
          />
        ) : tab === "announcements" ? (
          <StudentInboxThreadList
            emptyText="Class announcements will appear here."
            threads={announcementThreads.map((thread) => ({
              id: thread.programId,
              title: thread.program?.title ?? "Class announcement",
              subtitle: thread.latest ? `${thread.latest.author?.full_name ?? "Teacher"} - ${thread.latest.message}` : "No announcements yet",
              meta: thread.latest ? timeAgo(thread.latest.created_at) : "",
              unreadCount: thread.unreadCount,
              onClick: () => void openThread({ kind: "announcements", programId: thread.programId }),
            }))}
          />
        ) : tab === "notes" ? (
          <StudentInboxThreadList
            emptyText="Teacher notes, homework, feedback, and progress updates will appear here."
            threads={noteThreads.map((thread) => ({
              id: `${thread.programId}-${thread.studentId}`,
              title: thread.program?.title ?? "Class note",
              subtitle: `${thread.latest.author?.full_name ?? "Teacher"} - ${thread.latest.message}`,
              meta: `${thread.student?.full_name ?? "Student"} - ${timeAgo(thread.latest.created_at)}`,
              unreadCount: thread.unreadCount,
              onClick: () => void openThread({ kind: "notes", programId: thread.programId, studentId: thread.studentId }),
            }))}
          />
        ) : (
          <>
            <InboxSection title="Pending" count={pendingRequests.length + pendingWithdrawals.length}>
              {pendingRequests.length || pendingWithdrawals.length ? (
                <>
                  {pendingRequests.map((request) => (
                    <StudentRequestCard key={request.id} request={request} onRescind={() => setRescindTarget(request)} />
                  ))}
                  {pendingWithdrawals.map((request) => (
                    <StudentWithdrawalStatusCard key={request.id} request={request} />
                  ))}
                </>
              ) : (
                <MiniEmpty text="No pending requests." />
              )}
            </InboxSection>
            <InboxSection title="Returned" count={returnedRequests.length + returnedWithdrawals.length} action={returnedRequests.length || returnedWithdrawals.length ? <ClearAllButton onClick={clearAllReturnedRequests} /> : null}>
              {returnedRequests.length || returnedWithdrawals.length ? (
                <>
                  {returnedRequests.map((request) => (
                    <StudentRequestCard
                      key={request.id}
                      request={request}
                      checkoutBusy={checkoutRequestId === request.id}
                      onCompleteRegistration={request.status === "approved" && request.program?.is_paid && !request.payment_bypassed ? () => startCheckout(request.id) : undefined}
                      onDismiss={() => updateRequest(request.id, "dismiss")}
                    />
                  ))}
                  {returnedWithdrawals.map((request) => (
                    <StudentWithdrawalStatusCard key={request.id} request={request} onDismiss={() => dismissWithdrawalRequests([request.id])} />
                  ))}
                </>
              ) : (
                <MiniEmpty text="Accepted or rejected requests will appear here." />
              )}
            </InboxSection>
          </>
        )}
      </div>
      {paymentNotice ? (
        <PaymentResultModal
          status={paymentNotice}
          slug={slug}
          onClose={() => {
            setPaymentNotice(null);
            window.dispatchEvent(new Event("tareeqah:notifications-changed"));
            void loadInbox();
          }}
        />
      ) : null}
      {paymentConfirming ? <PaymentConfirmingModal /> : null}
      {protectedClear ? (
        <ProtectedPaidApplicationClearModal
          count={protectedClear.count}
          mode={protectedClear.mode}
          onCancel={() => setProtectedClear(null)}
          onConfirm={() => {
            const requestIds = protectedClear.requestIds;
            setProtectedClear(null);
            void dismissRequests(requestIds);
          }}
        />
      ) : null}
      {rescindTarget ? (
        <ConfirmStudentRescindModal
          request={rescindTarget}
          busy={rescindBusy}
          onCancel={() => {
            if (!rescindBusy) {
              setRescindTarget(null);
            }
          }}
          onConfirm={() => void confirmRescindRequest()}
        />
      ) : null}
    </div>
  );
}

function ConfirmStudentRescindModal({
  request,
  busy,
  onCancel,
  onConfirm,
}: {
  request: RequestWithContext;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-[#26323A] shadow-[0_24px_60px_rgba(38,50,58,0.22)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF2EF] text-[#C84B3E]">
          <XIcon />
        </div>
        <h2 className="mt-4 text-xl font-semibold">Rescind application?</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          This will cancel the pending application for {request.student?.full_name ?? "this student"} in {request.program?.title ?? "this class"}.
        </p>
        <div className="mt-6 grid gap-2">
          <button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 rounded-[8px] bg-[#26323A] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Rescinding..." : "Rescind application"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-[8px] bg-[#EEF3F5] px-4 text-sm font-semibold text-[#52616A] disabled:opacity-60">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function TeacherInboxData({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  const [announcements, setAnnouncements] = useState<AnnouncementWithContext[]>([]);
  const [requests, setRequests] = useState<RequestWithContext[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestWithContext[]>([]);
  const [instructorNotifications, setInstructorNotifications] = useState<InstructorLifecycleNotification[]>([]);
  const initialTeacherInboxTab = searchParams.get("tab");
  const [tab, setTab] = useState<"requests" | "withdrawals" | "instructors">(initialTeacherInboxTab === "withdrawals" || initialTeacherInboxTab === "instructors" ? initialTeacherInboxTab : "requests");
  const [canReviewRequests, setCanReviewRequests] = useState(false);
  const [message, setMessage] = useState("");
  const [announcementTracksByProgramId, setAnnouncementTracksByProgramId] = useState<Record<string, ProgramTrack[]>>({});
  const [selectedAnnouncementTargetValue, setSelectedAnnouncementTargetValue] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<{ request: RequestWithContext; action: "approved" | "waitlisted" | "rejected" } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [busyWithdrawalId, setBusyWithdrawalId] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (nextTab === "requests" || nextTab === "withdrawals" || nextTab === "instructors") {
      setTab(nextTab);
    }
  }, [searchParams]);

  async function loadTeacherInbox() {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setCurrentUserId(null);
      setSeenRequestIds(new Set());
      setCanReviewRequests(false);
      setLoading(false);
      return;
    }

    setCurrentUserId(userId);
    setSeenRequestIds(readSeenNotificationIds(seenTeacherRequestsStorageKey, userId));
    const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (!mosque) {
      setLoading(false);
      return;
    }

    const [{ data: mosquePrograms }, { data: assignments }] = await Promise.all([
      supabase.from("programs").select("*").eq("mosque_id", mosque.id).eq("is_active", true),
      supabase.from("program_teachers").select("program_id, role").eq("teacher_profile_id", userId),
    ]);
    const assignedIds = new Set((assignments ?? []).map((assignment) => assignment.program_id));
    const directorAssignmentIds = new Set((assignments ?? []).filter((assignment) => assignment.role === "director").map((assignment) => assignment.program_id));
    const teacherPrograms = (mosquePrograms ?? []).filter((program) => (program.director_profile_id ?? program.teacher_profile_id) === userId || assignedIds.has(program.id));
    const directorProgramIds = teacherPrograms
      .filter((program) => (program.director_profile_id ?? program.teacher_profile_id) === userId || directorAssignmentIds.has(program.id))
      .map((program) => program.id);
    setPrograms(teacherPrograms);
    setCanReviewRequests(directorProgramIds.length > 0);
    const activeProgramId = selectedProgramId || teacherPrograms[0]?.id || "";
    if (!selectedProgramId && activeProgramId) {
      setSelectedProgramId(activeProgramId);
    }

    const programIds = teacherPrograms.map((program) => program.id);
    if (programIds.length === 0) {
      setAnnouncements([]);
      setRequests([]);
      setWithdrawals([]);
      setInstructorNotifications([]);
      setAnnouncementTracksByProgramId({});
      setSelectedAnnouncementTargetValue("");
      setCanReviewRequests(false);
      setLoading(false);
      return;
    }

    const [
      { data: announcementRows, error: announcementError },
      { data: requestRows, error: requestError },
      { data: withdrawalRows, error: withdrawalError },
      { data: instructorRows, error: instructorError },
      { data: instructorEventRows, error: instructorEventError },
      { data: trackRows },
    ] = await Promise.all([
      activeProgramId
        ? supabase.from("program_announcements").select("*").eq("program_id", activeProgramId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as AnnouncementWithContext[], error: null }),
      directorProgramIds.length
        ? supabase.from("enrollment_requests").select("*").in("program_id", directorProgramIds).is("teacher_dismissed_at", null).order("requested_at", { ascending: false })
        : Promise.resolve({ data: [] as EnrollmentRequest[], error: null }),
      directorProgramIds.length
        ? supabase.from("withdrawal_requests").select("*").in("program_id", directorProgramIds).is("teacher_dismissed_at", null).order("requested_at", { ascending: false })
        : Promise.resolve({ data: [] as WithdrawalRequest[], error: null }),
      directorProgramIds.length
        ? supabase
            .from("program_teachers")
            .select("*")
            .in("program_id", directorProgramIds)
            .eq("role", "instructor")
            .not("teacher_profile_id", "is", null)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as ProgramTeacher[], error: null }),
      directorProgramIds.length
        ? supabase.from("program_instructor_events").select("*").in("program_id", directorProgramIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as ProgramInstructorEvent[], error: null }),
      programIds.length
        ? supabase.from("program_tracks").select("*").in("program_id", programIds).eq("is_active", true).order("sort_order", { ascending: true })
        : Promise.resolve({ data: [] as ProgramTrack[] }),
    ]);

    if (announcementError || requestError || withdrawalError || instructorError || instructorEventError) {
      setError(announcementError?.message ?? requestError?.message ?? withdrawalError?.message ?? instructorError?.message ?? instructorEventError?.message ?? "Could not load teacher inbox.");
      setLoading(false);
      return;
    }

    const studentIds = Array.from(new Set([...(requestRows ?? []).map((request) => request.student_profile_id), ...(withdrawalRows ?? []).map((request) => request.student_profile_id)]));
    const parentIds = Array.from(new Set([...(requestRows ?? []).map((request) => request.parent_profile_id).filter(Boolean), ...(withdrawalRows ?? []).map((request) => request.parent_profile_id).filter(Boolean)])) as string[];
    const authorIds = Array.from(new Set((announcementRows ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean))) as string[];
    const instructorIds = Array.from(
      new Set([
        ...(instructorRows ?? []).map((instructor) => instructor.teacher_profile_id).filter(Boolean),
        ...(instructorEventRows ?? []).map((event) => event.teacher_profile_id).filter(Boolean),
      ]),
    ) as string[];
    const subscriptionStudentIds = Array.from(new Set((withdrawalRows ?? []).map((request) => request.student_profile_id)));
    const [{ data: students }, { data: parents }, { data: authors }, { data: instructorProfiles }, { data: subscriptions }] = await Promise.all([
      studentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type").in("id", studentIds)
        : Promise.resolve({ data: [] as StudentDisplay[] }),
      parentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url").in("id", parentIds)
        : Promise.resolve({ data: [] as ParentDisplay[] }),
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      instructorIds.length ? supabase.from("profiles").select("*").in("id", instructorIds) : Promise.resolve({ data: [] as Profile[] }),
      subscriptionStudentIds.length
        ? supabase.from("program_subscriptions").select("*").in("program_id", directorProgramIds).in("student_profile_id", subscriptionStudentIds)
        : Promise.resolve({ data: [] as ProgramSubscription[] }),
    ]);

    const tracksByProgramId = (trackRows ?? []).reduce<Record<string, ProgramTrack[]>>((next, track) => {
      next[track.program_id] = [...(next[track.program_id] ?? []), track];
      return next;
    }, {});
    setAnnouncementTracksByProgramId(tracksByProgramId);
    if (!selectedAnnouncementTargetValue && activeProgramId) {
      setSelectedAnnouncementTargetValue(announcementTargetValue(activeProgramId, null));
    }
    setAnnouncements(
      (announcementRows ?? []).map((announcement) => ({
        ...announcement,
        program: teacherPrograms.find((program) => program.id === announcement.program_id) ?? null,
        author: (authors ?? []).find((author) => author.id === announcement.author_profile_id) ?? null,
      })),
    );
    setRequests(
      (requestRows ?? []).map((request) => ({
        ...request,
        program: teacherPrograms.find((program) => program.id === request.program_id) ?? null,
        student: (students ?? []).find((student) => student.id === request.student_profile_id) ?? null,
        parent: request.parent_profile_id ? ((parents ?? []).find((parent) => parent.id === request.parent_profile_id) as ParentDisplay | undefined) ?? null : null,
      })),
    );
    setWithdrawals(
      (withdrawalRows ?? []).map((request) => ({
        ...request,
        program: teacherPrograms.find((program) => program.id === request.program_id) ?? null,
        student: (students ?? []).find((student) => student.id === request.student_profile_id) ?? null,
        parent: request.parent_profile_id ? ((parents ?? []).find((parent) => parent.id === request.parent_profile_id) as ParentDisplay | undefined) ?? null : null,
        subscription:
          (subscriptions ?? []).find((subscription) => subscription.program_id === request.program_id && subscription.student_profile_id === request.student_profile_id) ?? null,
      })),
    );
    const joinedAssignmentIdsWithEvents = new Set((instructorEventRows ?? []).filter((event) => event.event_type === "joined" && event.assignment_id).map((event) => event.assignment_id as string));
    const instructorEventNotifications: InstructorLifecycleNotification[] = (instructorEventRows ?? []).map((event) => ({
      id: event.id,
      program_id: event.program_id,
      assignment_id: event.assignment_id,
      teacher_profile_id: event.teacher_profile_id,
      event_type: event.event_type === "resigned" ? "resigned" : "joined",
      created_at: event.created_at,
      program: teacherPrograms.find((program) => program.id === event.program_id) ?? null,
      instructor: event.teacher_profile_id ? ((instructorProfiles ?? []).find((profile) => profile.id === event.teacher_profile_id) as Profile | undefined) ?? null : null,
    }));
    const fallbackJoinNotifications: InstructorLifecycleNotification[] = (instructorRows ?? [])
      .filter((notification) => !joinedAssignmentIdsWithEvents.has(notification.id))
      .map((notification) => ({
        id: notification.id,
        program_id: notification.program_id,
        assignment_id: notification.id,
        teacher_profile_id: notification.teacher_profile_id,
        event_type: "joined",
        created_at: notification.created_at,
        program: teacherPrograms.find((program) => program.id === notification.program_id) ?? null,
        instructor: notification.teacher_profile_id ? ((instructorProfiles ?? []).find((profile) => profile.id === notification.teacher_profile_id) as Profile | undefined) ?? null : null,
      }));
    const dismissedInstructorUpdateIds = readSeenNotificationIds(dismissedTeacherInstructorUpdatesStorageKey, userId);
    setInstructorNotifications(
      [...instructorEventNotifications, ...fallbackJoinNotifications]
        .filter((notification) => !dismissedInstructorUpdateIds.has(teacherInstructorNotificationKey(notification)))
        .sort((a, b) => Date.parse(b.created_at ?? "0") - Date.parse(a.created_at ?? "0")),
    );
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadTeacherInbox();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, selectedProgramId]);

  async function sendAnnouncement() {
    if (!currentUserId || !selectedProgramId || !message.trim()) {
      return;
    }

    const selectedTarget = parseAnnouncementTargetValue(selectedAnnouncementTargetValue || announcementTargetValue(selectedProgramId, null));
    const targetTrackIds = selectedTarget.trackId ? [selectedTarget.trackId] : [];

    const supabase = createSupabaseBrowserClient();
    const { error: insertError } = await supabase.from("program_announcements").insert({
      program_id: selectedTarget.programId || selectedProgramId,
      author_profile_id: currentUserId,
      message: message.trim(),
      target_program_track_ids: targetTrackIds,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMessage("");
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadTeacherInbox();
  }

  async function clearPastRequest(requestId: string) {
    setError(null);
    const { error: clearError } = await createSupabaseBrowserClient()
      .from("enrollment_requests")
      .update({ teacher_dismissed_at: new Date().toISOString() })
      .eq("id", requestId);

    if (clearError) {
      setError(clearError.message);
      return;
    }

    setRequests((current) => current.filter((request) => request.id !== requestId));
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  async function clearAllPastRequests() {
    const pastRequestIds = pastRequests.map((request) => request.id);
    if (!pastRequestIds.length) {
      return;
    }

    setError(null);
    const { error: clearError } = await createSupabaseBrowserClient()
      .from("enrollment_requests")
      .update({ teacher_dismissed_at: new Date().toISOString() })
      .in("id", pastRequestIds);

    if (clearError) {
      setError(clearError.message);
      return;
    }

    setRequests((current) => current.filter((request) => !pastRequestIds.includes(request.id)));
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  async function reviewRequest(
    request: RequestWithContext,
    status: "approved" | "waitlisted" | "rejected",
    options: { priceMonthlyCents?: number | null; paymentBypassed?: boolean; note?: string | null } = {},
  ) {
    if (!currentUserId) {
      return;
    }

    if (status === "approved" && request.program?.is_paid && !options.paymentBypassed && (options.priceMonthlyCents ?? 0) < 50) {
      setError("Paid approvals need a monthly price of at least $0.50, or choose bypass payment.");
      return;
    }

    setReviewBusy(true);
    const supabase = createSupabaseBrowserClient();
    const now = new Date().toISOString();
    const { error: reviewError } = await supabase
      .from("enrollment_requests")
      .update({
        status,
        reviewed_by: currentUserId,
        reviewed_at: now,
        review_note: options.note?.trim() || null,
        decision_note: options.note?.trim() || null,
        approved_price_monthly_cents: status === "approved" ? (options.paymentBypassed ? 0 : options.priceMonthlyCents ?? request.program?.price_monthly_cents ?? null) : null,
        payment_bypassed: status === "approved" ? Boolean(options.paymentBypassed) : false,
        admission_completed_at: status === "approved" && (!request.program?.is_paid || options.paymentBypassed) ? now : null,
        teacher_dismissed_at: null,
      })
      .eq("id", request.id);

    if (reviewError) {
      setReviewBusy(false);
      setError(reviewError.message);
      return;
    }

    if (status === "approved" && (!request.program?.is_paid || options.paymentBypassed)) {
      await supabase.from("enrollments").upsert(
        {
          program_id: request.program_id,
          student_profile_id: request.student_profile_id,
          program_track_id: request.program_track_id,
        },
        { onConflict: "program_id,student_profile_id" },
      );
    }

    queueEnrollmentRequestReviewedEmail(request.id);
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadTeacherInbox();
    setReviewBusy(false);
    setReviewTarget(null);
    setToast({ tone: "success", message: status === "approved" ? "Application accepted." : status === "waitlisted" ? "Application waitlisted." : "Application rejected." });
  }

  async function reviewWithdrawal(request: WithdrawalRequestWithContext, status: "approved" | "rejected") {
    setBusyWithdrawalId(request.id);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setBusyWithdrawalId(null);
      setError("Please sign in again to review this withdrawal.");
      return;
    }

    const response = await fetch("/api/withdrawal-requests/review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ withdrawalRequestId: request.id, status }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusyWithdrawalId(null);
    if (!response.ok) {
      setError(result.error ?? "Could not review withdrawal request.");
      return;
    }
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadTeacherInbox();
  }

  function clearAllInstructorUpdates() {
    if (!instructorNotificationIds.length) {
      return;
    }
    markNotificationIdsSeen(dismissedTeacherInstructorUpdatesStorageKey, currentUserId, instructorNotificationIds);
    setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, instructorNotificationIds));
    setInstructorNotifications([]);
  }

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const pastRequests = requests.filter((request) => request.status !== "pending");
  const completedAdmissionRequests = pastRequests.filter((request) => request.admission_completed_at && !request.teacher_dismissed_at);
  const pendingWithdrawals = withdrawals.filter((request) => request.status === "pending");
  const pastWithdrawals = withdrawals.filter((request) => request.status !== "pending");
  const unseenInstructorCount = instructorNotifications.filter((notification) => !seenRequestIds.has(teacherInstructorNotificationKey(notification))).length;
  const unseenPendingRequestCount = [...pendingRequests, ...completedAdmissionRequests].filter((request) => !seenRequestIds.has(teacherRequestNotificationKey(request))).length;
  const selectedProgram = programs.find((program) => program.id === selectedProgramId);
  const announcementTargetOptions = programs.flatMap((program) => [
    { value: announcementTargetValue(program.id, null), label: announcementTargetLabel(program, null) },
    ...(announcementTracksByProgramId[program.id] ?? []).map((track) => ({
      value: announcementTargetValue(program.id, track.id),
      label: announcementTargetLabel(program, track),
    })),
  ]);
  const requestNotificationIds = [...pendingRequests, ...completedAdmissionRequests].map(teacherRequestNotificationKey);
  const instructorNotificationIds = instructorNotifications.map(teacherInstructorNotificationKey);
  const pendingRequestIdsKey = requestNotificationIds.join("|");
  const instructorIdsKey = instructorNotificationIds.join("|");

  useEffect(() => {
    if (!loading && tab === "requests" && pendingRequestIdsKey) {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, pendingRequestIdsKey.split("|")));
    }
  }, [currentUserId, loading, pendingRequestIdsKey, tab]);

  useEffect(() => {
    if (!loading && tab === "instructors" && instructorIdsKey) {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, instructorIdsKey.split("|")));
    }
  }, [currentUserId, instructorIdsKey, loading, tab]);

  function changeTab(nextTab: "requests" | "withdrawals" | "instructors") {
    setTab(nextTab);
    router.replace(`/m/${slug}/teacher/inbox?tab=${nextTab}`, { scroll: false });
    if (nextTab === "requests") {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, requestNotificationIds));
    }
    if (nextTab === "instructors") {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, instructorNotificationIds));
    }
  }

  return (
    <div className="bg-[var(--workspace)]">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <div className="md:hidden">
        <FloatingInboxTabs
          tabs={[
            { id: "requests", label: "Applications", badge: unseenPendingRequestCount },
            { id: "withdrawals", label: "Withdrawals", badge: pendingWithdrawals.length },
            { id: "instructors", label: "Instructors", badge: unseenInstructorCount },
          ]}
          value={tab}
          onChange={(value) => changeTab(value as "requests" | "withdrawals" | "instructors")}
        />
      </div>
      <div className="space-y-4 p-4">
        {error ? (
          <EmptyState title="Could not load teacher inbox" text={error} />
        ) : loading ? (
          <InboxLoadingPanel label={tab === "withdrawals" ? "Loading withdrawals" : tab === "instructors" ? "Loading instructors" : "Loading applications"} />
        ) : tab === "requests" ? (
          <>
            <TeacherRequestSection title="Pending Requests" count={pendingRequests.length}>
              {pendingRequests.length ? (
                pendingRequests.map((request) => (
                  <TeacherRequestCard
                    key={request.id}
                    request={request}
                    onAccept={() => setReviewTarget({ request, action: "approved" })}
                    onWaitlist={() => setReviewTarget({ request, action: "waitlisted" })}
                    onReject={() => setReviewTarget({ request, action: "rejected" })}
                  />
                ))
              ) : (
                <MiniEmpty text="No students are waiting for review." />
              )}
            </TeacherRequestSection>
            <TeacherRequestSection title="Past Requests" count={pastRequests.length} action={pastRequests.length ? <ClearAllButton onClick={clearAllPastRequests} /> : null}>
              {pastRequests.length ? (
                pastRequests.map((request) => (
                  <TeacherRequestCard key={request.id} request={request} reviewed onClear={() => clearPastRequest(request.id)} />
                ))
              ) : (
                <MiniEmpty text="Reviewed requests will appear here." />
              )}
            </TeacherRequestSection>
          </>
        ) : tab === "withdrawals" ? (
          <>
            <TeacherRequestSection title="Pending Withdrawals" count={pendingWithdrawals.length}>
              {pendingWithdrawals.length ? (
                pendingWithdrawals.map((request) => (
                  <WithdrawalRequestCard
                    key={request.id}
                    request={request}
                    busy={busyWithdrawalId === request.id}
                    onApprove={() => reviewWithdrawal(request, "approved")}
                    onReject={() => reviewWithdrawal(request, "rejected")}
                  />
                ))
              ) : (
                <MiniEmpty text="No withdrawal requests are waiting for review." />
              )}
            </TeacherRequestSection>
            <TeacherRequestSection title="Past Withdrawals" count={pastWithdrawals.length}>
              {pastWithdrawals.length ? (
                pastWithdrawals.map((request) => <WithdrawalRequestCard key={request.id} request={request} reviewed />)
              ) : (
                <MiniEmpty text="Reviewed withdrawal requests will appear here." />
              )}
            </TeacherRequestSection>
          </>
        ) : (
          <TeacherRequestSection title="Instructor Updates" count={instructorNotifications.length} action={instructorNotifications.length ? <ClearAllButton onClick={clearAllInstructorUpdates} /> : null}>
            {instructorNotifications.length ? (
              instructorNotifications.map((notification) => (
                <InstructorLifecycleNotificationCard key={`${notification.event_type}:${notification.id}`} notification={notification} slug={slug} />
              ))
            ) : (
              <MiniEmpty text="Instructor joins and resignations will appear here." />
            )}
          </TeacherRequestSection>
        )}
      </div>
      {reviewTarget ? (
        <ApplicationDecisionModal
          target={reviewTarget}
          busy={reviewBusy}
          onClose={() => {
            if (!reviewBusy) {
              setReviewTarget(null);
            }
          }}
          onSubmit={(options) => reviewRequest(reviewTarget.request, reviewTarget.action, options)}
        />
      ) : null}
    </div>
  );
}

export function TeacherAnnouncementData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [tracks, setTracks] = useState<ProgramTrack[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementWithContext[]>([]);
  const [readersByAnnouncementId, setReadersByAnnouncementId] = useState<Record<string, Profile[]>>({});
  const [message, setMessage] = useState("");
  const [selectedAnnouncementTargetValue, setSelectedAnnouncementTargetValue] = useState(announcementTargetValue(programId, null));
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAnnouncements() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    setCurrentUserId(userId);

    const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (!mosque) {
      setError("Masjid not found.");
      setLoading(false);
      return;
    }

    const { data: programRow, error: programError } = await supabase
      .from("programs")
      .select("*")
      .eq("id", programId)
      .eq("mosque_id", mosque.id)
      .maybeSingle();

    if (programError || !programRow) {
      setError(programError?.message ?? "Class not found.");
      setLoading(false);
      return;
    }

    const [{ data: announcementRows, error: announcementError }, { data: trackRows }] = await Promise.all([
      supabase
        .from("program_announcements")
        .select("*")
        .eq("program_id", programRow.id)
        .order("created_at", { ascending: false }),
      supabase.from("program_tracks").select("*").eq("program_id", programRow.id).eq("is_active", true).order("sort_order", { ascending: true }),
    ]);

    if (announcementError) {
      setError(announcementError.message);
      setLoading(false);
      return;
    }

    const authorIds = Array.from(new Set((announcementRows ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean))) as string[];
    const announcementIds = (announcementRows ?? []).map((announcement) => announcement.id);
    const [{ data: authors }, { data: receipts }] = await Promise.all([
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      announcementIds.length ? supabase.from("program_announcement_receipts").select("*").in("announcement_id", announcementIds) : Promise.resolve({ data: [] as AnnouncementReceipt[] }),
    ]);
    const readerIds = Array.from(new Set((receipts ?? []).filter((receipt) => receipt.read_at).map((receipt) => receipt.profile_id)));
    const { data: readerProfiles } = readerIds.length ? await supabase.from("profiles").select("*").in("id", readerIds) : { data: [] as Profile[] };
    const readerById = new Map((readerProfiles ?? []).map((reader) => [reader.id, reader]));
    const nextReaders: Record<string, Profile[]> = {};
    for (const receipt of receipts ?? []) {
      const reader = readerById.get(receipt.profile_id);
      if (receipt.read_at && reader) {
        nextReaders[receipt.announcement_id] = [...(nextReaders[receipt.announcement_id] ?? []), reader];
      }
    }

    const activeTracks = trackRows ?? [];
    setProgram(programRow);
    setTracks(activeTracks);
    setSelectedAnnouncementTargetValue((current) => {
      const target = parseAnnouncementTargetValue(current);
      return target.programId === programRow.id && (!target.trackId || activeTracks.some((track) => track.id === target.trackId))
        ? current
        : announcementTargetValue(programRow.id, null);
    });
    setReadersByAnnouncementId(nextReaders);
    setAnnouncements(
      (announcementRows ?? []).map((announcement) => ({
        ...announcement,
        program: programRow,
        author: (authors ?? []).find((author) => author.id === announcement.author_profile_id) ?? null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAnnouncements();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, slug]);

  async function sendAnnouncement() {
    if (!currentUserId || !program || !message.trim()) {
      return;
    }

    const target = parseAnnouncementTargetValue(selectedAnnouncementTargetValue || announcementTargetValue(program.id, null));
    const targetTrackIds = target.trackId ? [target.trackId] : [];

    const supabase = createSupabaseBrowserClient();
    const { error: insertError } = await supabase.from("program_announcements").insert({
      program_id: program.id,
      author_profile_id: currentUserId,
      message: message.trim(),
      target_program_track_ids: targetTrackIds,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("");
    setSelectedAnnouncementTargetValue(announcementTargetValue(program.id, null));
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadAnnouncements();
  }

  if (loading) {
    return <InboxLoadingPanel label="Loading announcements" />;
  }

  if (error) {
    return <EmptyState title="Could not load announcements" text={error} />;
  }

  return (
    <section className="space-y-4 bg-[var(--workspace)] p-4">
      {program ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Class</p>
          <h2 className="mt-1 text-2xl font-semibold leading-8 text-[#26323A]">{program.title}</h2>
          <p className="mt-1 text-sm text-[#6B747B]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
        </div>
      ) : null}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Send to</label>
        <select
          value={selectedAnnouncementTargetValue}
          onChange={(event) => setSelectedAnnouncementTargetValue(event.target.value)}
          className="mt-2 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        >
          {program ? <option value={announcementTargetValue(program.id, null)}>{announcementTargetLabel(program, null)}</option> : null}
          {program
            ? tracks.map((track) => (
                <option key={track.id} value={announcementTargetValue(program.id, track.id)}>
                  {announcementTargetLabel(program, track)}
                </option>
              ))
            : null}
        </select>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write an announcement..."
          className="mt-3 min-h-24 w-full resize-none border border-[#B9C3C8] bg-white px-3 py-2 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={sendAnnouncement} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#17624F] px-5 text-sm font-semibold text-white hover:bg-[#0F4537]">
            Send
          </button>
        </div>
      </div>
      <ProgramAnnouncementFeed program={program} announcements={announcements} readersByAnnouncementId={readersByAnnouncementId} viewer="teacher" />
    </section>
  );
}

const scheduleDayOptions = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const scheduleTimeOptions = Array.from({ length: 33 }, (_, index) => {
  const totalMinutes = 6 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

export function TeacherScheduleData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [rows, setRows] = useState<ProgramScheduleRow[]>([]);
  const [initialRows, setInitialRows] = useState<ProgramScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSchedule() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();

    const { data: mosque, error: mosqueError } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (mosqueError || !mosque) {
      setError(mosqueError?.message ?? "Masjid not found.");
      setLoading(false);
      return;
    }

    const { data: programRow, error: programError } = await supabase
      .from("programs")
      .select("*")
      .eq("id", programId)
      .eq("mosque_id", mosque.id)
      .maybeSingle();

    if (programError || !programRow) {
      setError(programError?.message ?? "Class not found.");
      setLoading(false);
      return;
    }

    const parsedRows = parseProgramSchedule(programRow.schedule);
    setProgram(programRow);
    setRows(parsedRows);
    setInitialRows(parsedRows);
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSchedule();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, slug]);

  function toggleDay(day: (typeof scheduleDayOptions)[number]) {
    setSaved(false);
    setRows((currentRows) => {
      if (currentRows.some((row) => row.day === day)) {
        return currentRows.filter((row) => row.day !== day);
      }
      const nextRows = [...currentRows, { day, start: "18:00", end: "20:00" }];
      return sortScheduleRows(nextRows);
    });
  }

  function updateRow(day: (typeof scheduleDayOptions)[number], key: "start" | "end", value: string) {
    setSaved(false);
    setRows((currentRows) => currentRows.map((row) => (row.day === day ? { ...row, [key]: value } : row)));
  }

  async function saveSchedule() {
    if (!program) {
      return;
    }

    const invalidRow = rows.find((row) => row.end <= row.start);
    if (invalidRow) {
      setError(`${invalidRow.day} needs an end time after its start time.`);
      return;
    }

    setSaving(true);
    setError(null);
    const schedule = rows.map((row) => ({ day: row.day, start: row.start, end: row.end })) as Json;
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("programs")
      .update({
        schedule,
        schedule_notes: rows.length ? null : "Schedule TBA",
      })
      .eq("id", program.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const nextProgram = { ...program, schedule, schedule_notes: rows.length ? null : "Schedule TBA" };
    setProgram(nextProgram);
    setInitialRows(rows);
    mosqueProgramsCache.delete(slug);
    window.dispatchEvent(new Event("tareeqah:programs-changed"));
    setSaved(true);
    setSaving(false);
  }

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error && !program) {
    return <EmptyState title="Could not load schedule" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This schedule could not be loaded." />;
  }

  return (
    <section className="bg-[var(--workspace)] p-4">
      <div className="space-y-5 rounded-[28px] bg-white p-5 shadow-[0_12px_32px_rgba(38,50,58,0.08)]">
        <div>
          <h2 className="text-2xl font-semibold leading-8 text-[#26323A]">Class schedule</h2>
          <p className="mt-2 text-sm leading-6 text-[#6B747B]">Choose any number of class days, then set the time range for each selected day.</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Class</p>
          <h3 className="mt-1 text-lg font-semibold text-[#26323A]">{program.title}</h3>
          <p className="mt-1 text-sm text-[#6B747B]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-[#26323A]">Available days</h3>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {scheduleDayOptions.map((day) => {
              const selected = rows.some((row) => row.day === day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "min-h-10 rounded-[6px] border px-2 text-sm font-semibold transition-colors",
                    selected ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#D6DCE0] bg-white text-[#26323A] hover:border-[#8ABFB3]",
                  )}
                >
                  {day.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="text-base font-semibold text-[#26323A]">Hours</h3>
          <p className="mt-1 text-sm text-[#6B747B]">Set the start and end time for each class day.</p>
          <div className="mt-4 space-y-4">
            {rows.length ? (
              rows.map((row) => (
                <div key={row.day}>
                  <p className="mb-2 text-sm font-semibold text-[#26323A]">{row.day}</p>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <select value={row.start} onChange={(event) => updateRow(row.day, "start", event.target.value)} className="h-11 rounded-[6px] border border-[#D6DCE0] bg-white px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]">
                      {scheduleTimeOptions.map((time) => (
                        <option key={time} value={time}>{formatClockLabel(time)}</option>
                      ))}
                    </select>
                    <span className="text-sm text-[#6B747B]">to</span>
                    <select value={row.end} onChange={(event) => updateRow(row.day, "end", event.target.value)} className="h-11 rounded-[6px] border border-[#D6DCE0] bg-white px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]">
                      {scheduleTimeOptions.map((time) => (
                        <option key={time} value={time}>{formatClockLabel(time)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-dashed border-[#D6DCE0] bg-[#F8FAFB] px-4 py-6 text-center text-sm text-[#6B747B]">
                Select one or more days to build this class schedule.
              </div>
            )}
          </div>
        </div>

        {error ? <div className="rounded-[18px] border border-[#F4C7C1] bg-[#FDEDEA] px-4 py-3 text-sm text-[#A4352A]">{error}</div> : null}
        {saved ? <div className="rounded-[18px] border border-[#BEE5D4] bg-[#EAF8F1] px-4 py-3 text-sm text-[#17624F]">Schedule saved.</div> : null}

        <div className="flex justify-end gap-3 border-t border-[#EEF2F4] pt-4">
          <button type="button" onClick={() => { setRows(initialRows); setError(null); setSaved(false); }} className="min-h-10 rounded-[6px] border border-[#D6DCE0] bg-white px-5 text-sm font-semibold text-[#26323A] hover:bg-[var(--workspace)]">
            Cancel
          </button>
          <button type="button" onClick={saveSchedule} disabled={saving} className="min-h-10 rounded-[6px] bg-[#17624F] px-5 text-sm font-semibold text-white hover:bg-[#0F4537] disabled:opacity-60">
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function TeacherHomeData({ slug }: { slug: string }) {
  const { programs, currentUserId, loading, error } = useTeacherPrograms(slug);
  const { totalCount: inboxItemCount } = useTeacherNotificationCounts(currentUserId ? slug : "");

  if (loading) {
    return <HomeLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load teacher home" text={error} />;
  }

  return (
    <div className="space-y-4 bg-[var(--workspace)] p-4">
      <HomeNotification
        tone={inboxItemCount > 0 ? "active" : "empty"}
        title={inboxItemCount > 0 ? "Action required" : "No new inbox items"}
        text={inboxItemCount > 0 ? `Check your inbox to review ${inboxItemCount === 1 ? "the new item" : `${inboxItemCount} new items`}.` : "New enrollment requests and class messages will appear here."}
        href={inboxItemCount > 0 ? `/m/${slug}/teacher/inbox` : undefined}
      />
      <HomeSectionTitle title="Upcoming" />
      {programs.length ? <HomeUpcomingRows programs={programs} canCancelSessions currentUserId={currentUserId} /> : <HomeEmptyState title="No assigned classes" text="Your next class sessions will appear here." />}
    </div>
  );
}

export function AdminHomeData({ slug }: { slug: string }) {
  const { programs, loading, error } = useAdminProgramsWithTracks(slug);

  if (loading) {
    return <HomeLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load admin home" text={error} />;
  }

  return (
    <div className="space-y-4 bg-[var(--workspace)] p-4">
      <HomeSectionTitle title="Upcoming" />
      {programs.length ? <HomeUpcomingRows programs={programs} /> : <HomeEmptyState title="No classes yet" text="All masjid class sessions will appear here after classes are created." />}
    </div>
  );
}

export function TeacherClassesData({ slug }: { slug: string }) {
  const { programs, allPrograms, roleByProgramId, financeAccessByProgramId, canCreateClass, loading, error } = useTeacherPrograms(slug);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTeacherClassesTab = searchParams.get("tab");
  const [tab, setTab] = useState<"mine" | "other">(initialTeacherClassesTab === "other" ? "other" : "mine");
  const [hiddenProgramIds, setHiddenProgramIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<EditorToastState | null>(null);

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (nextTab === "mine" || nextTab === "other") {
      setTab(nextTab);
    }
  }, [searchParams]);

  function changeTeacherClassesTab(nextTab: "mine" | "other") {
    setTab(nextTab);
    router.replace(`/m/${slug}/teacher/classes?tab=${nextTab}`, { scroll: false });
  }

  useEffect(() => {
    const queuedToast = readQueuedEditorToast();
    if (queuedToast) {
      setToast(queuedToast);
    }
  }, []);

  if (loading) {
    return <ClassesLoadingPlaceholders count={2} />;
  }

  if (error) {
    return <EmptyState title="Could not load classes" text={error} />;
  }

  const visiblePrograms = programs.filter((program) => !hiddenProgramIds.has(program.id));
  const assignedProgramIds = new Set(programs.map((program) => program.id));
  const otherPrograms = allPrograms.filter((program) => !assignedProgramIds.has(program.id));

  return (
    <section className="bg-[var(--workspace)]">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <div className="grid grid-cols-2 border-b border-[#D6DCE0] md:hidden">
        <button
          type="button"
          onClick={() => changeTeacherClassesTab("mine")}
          className={cn("min-h-12 text-sm font-medium", tab === "mine" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          My Classes
        </button>
        <button
          type="button"
          onClick={() => changeTeacherClassesTab("other")}
          className={cn("min-h-12 text-sm font-medium", tab === "other" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          Other Classes
        </button>
      </div>

      <div className="space-y-4 p-4">
        {tab === "mine" ? (
          <>
          {visiblePrograms.length === 0 ? (
            <EmptyState title="No assigned classes" text="Classes you direct or instruct will appear here." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {visiblePrograms.map((program) => (
                <TeacherClassCard
                  key={program.id}
                  program={program}
                  mosqueSlug={slug}
                  role={roleByProgramId[program.id] ?? "instructor"}
                  canManageFinances={financeAccessByProgramId[program.id] ?? false}
                  onResigned={() => {
                    setHiddenProgramIds((current) => new Set([...current, program.id]));
                    setToast({ tone: "success", message: "You resigned from the class." });
                  }}
                  onResignError={(message) => setToast({ tone: "error", message })}
                />
              ))}
            </div>
          )}
            <TeacherWorkspaceTools slug={slug} mode="create" canCreateClass={canCreateClass} />
          </>
        ) : (
          <>
            <TeacherWorkspaceTools slug={slug} mode="invite" canCreateClass={canCreateClass} />
          {otherPrograms.length === 0 ? (
            <EmptyState title="No other classes" text="Every active class at this masjid is already assigned to you." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {otherPrograms.map((program) => (
                <TeacherOtherClassCard key={program.id} program={program} mosqueSlug={slug} />
              ))}
            </div>
          )}
          </>
        )}
      </div>
    </section>
  );
}

export function AdminClassesData({ slug }: { slug: string }) {
  const { programs, canCreateClass, loading, error } = useTeacherPrograms(slug);
  const [toast, setToast] = useState<EditorToastState | null>(null);

  useEffect(() => {
    const queuedToast = readQueuedEditorToast();
    if (queuedToast) {
      setToast(queuedToast);
    }
  }, []);

  if (loading) {
    return <ClassesLoadingPlaceholders count={3} />;
  }

  if (error) {
    return <EmptyState title="Could not load classes" text={error} />;
  }

  return (
    <section className="space-y-4 bg-[var(--workspace)] p-4">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <AdminMosqueSwitcher slug={slug} target="programs" />
      {programs.length === 0 ? (
        <EmptyState title="No classes yet" text="Classes created for this masjid will appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {programs.map((program) => (
            <TeacherClassCard key={program.id} program={program} mosqueSlug={slug} role="director" basePath={`/m/${slug}/admin/programs`} controlLabel="Admin Control" canManageFinances />
          ))}
        </div>
      )}
      <TeacherWorkspaceTools slug={slug} mode="create" canCreateClass={canCreateClass} createHref={`/m/${slug}/admin/programs/new`} />
    </section>
  );
}

function AdminMosqueSwitcher({ slug, target = "programs" }: { slug: string; target?: "programs" | "masjid" | "finances" }) {
  const router = useRouter();
  const [mosques, setMosques] = useState<Array<Pick<Mosque, "id" | "name" | "slug">>>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void (async () => {
        const session = await loadCachedSession();
        const userId = session?.user.id;
        if (!userId) {
          setMosques([]);
          return;
        }
        const supabase = createSupabaseBrowserClient();
        const { data: memberships } = await supabase
          .from("mosque_memberships")
          .select("mosque_id")
          .eq("profile_id", userId)
          .eq("role", "admin")
          .eq("status", "active");
        const mosqueIds = (memberships ?? []).map((membership) => membership.mosque_id);
        const { data } = mosqueIds.length
          ? await supabase.from("mosques").select("id, name, slug").in("id", mosqueIds).order("name", { ascending: true })
          : { data: [] as Array<Pick<Mosque, "id" | "name" | "slug">> };
        setMosques(data ?? []);
      })();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  if (mosques.length <= 1) {
    return null;
  }

  return (
    <label className="block rounded-[18px] border border-[#D6DCE0] bg-white p-3 shadow-[0_8px_22px_rgba(38,50,58,0.05)]">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7B858C]">Viewing masjid</span>
      <select
        value={slug}
        onChange={(event) => router.push(`/m/${event.target.value}/admin/${target === "masjid" ? "masjid" : target === "finances" ? "finances" : "programs"}`)}
        className="mt-2 h-11 w-full rounded-[12px] border border-[#D6DCE0] bg-[#F8FAFB] px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]"
      >
        {mosques.map((mosque) => (
          <option key={mosque.id} value={mosque.slug}>{mosque.name}</option>
        ))}
      </select>
    </label>
  );
}

export function AdminMasjidData({ slug }: { slug: string }) {
  const [mosque, setMosque] = useState<Mosque | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        const { data, error: mosqueError } = await createSupabaseBrowserClient().from("mosques").select("*").eq("slug", slug).maybeSingle();
        if (mosqueError) {
          setError(mosqueError.message);
        }
        setMosque(data ?? null);
        setLoading(false);
      })();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  if (loading) {
    return <ClassesLoadingPlaceholders count={1} />;
  }

  if (error) {
    return <EmptyState title="Could not load masjid" text={error} />;
  }

  if (!mosque) {
    return <EmptyState title="Masjid not found" text="This masjid could not be loaded." />;
  }

  return (
    <section className="space-y-4 bg-[var(--workspace)] p-4">
      <AdminMosqueSwitcher slug={slug} target="masjid" />
      <article className="overflow-hidden rounded-[24px] border border-[#CBD8DE] bg-white shadow-[0_16px_40px_rgba(38,50,58,0.09)]">
        <div className="relative h-44 bg-[#EAF4F2]">
          {mosque.picture_url ? (
            <Image src={mosque.picture_url} alt="" fill sizes="420px" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl font-semibold text-[#17624F]">{initials(mosque.name)}</div>
          )}
        </div>
        <div className="space-y-4 p-4">
          <div>
            <span className="inline-flex min-h-7 items-center rounded-full bg-[#E7F3F8] px-3 text-xs font-bold uppercase tracking-wide text-[#2F6077]">Masjid Control</span>
            <h2 className="mt-3 text-2xl font-semibold leading-7 text-[#26323A]">{mosque.name}</h2>
          </div>
          <div className="divide-y divide-[#E3E8EC] border-t border-[#E3E8EC]">
            <TeacherActionLink href={`/m/${slug}/admin/students`} icon={<StudentsIcon />} label="Manage Members" />
            <TeacherActionLink href={`/m/${slug}/admin/finances`} icon={<FinanceIcon />} label="Manage Finances" />
          </div>
        </div>
      </article>
    </section>
  );
}

export function AdminMasjidFinancesData({ slug }: { slug: string }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        const supabase = createSupabaseBrowserClient();
        const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
        if (!mosque) {
          setError("Masjid not found.");
          setLoading(false);
          return;
        }
        const { data, error: programsError } = await supabase.from("programs").select("*").eq("mosque_id", mosque.id).order("title", { ascending: true });
        if (programsError) {
          setError(programsError.message);
          setLoading(false);
          return;
        }
        setPrograms(data ?? []);
        setSelectedProgramId((current) => current || data?.[0]?.id || "");
        setLoading(false);
      })();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error) {
    return <EmptyState title="Could not load finances" text={error} />;
  }

  if (!programs.length) {
    return (
      <section className="space-y-4 bg-white p-4">
        <AdminMosqueSwitcher slug={slug} target="finances" />
        <EmptyState title="No classes yet" text="Create a class before managing finances." />
      </section>
    );
  }

  return (
    <section className="space-y-4 bg-white p-4 pb-28">
      <AdminMosqueSwitcher slug={slug} target="finances" />
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7B858C]">Class finances</span>
        <select
          value={selectedProgramId}
          onChange={(event) => setSelectedProgramId(event.target.value)}
          className="mt-2 h-11 w-full rounded-[12px] border border-[#D6DCE0] bg-[#F8FAFB] px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]"
        >
          {programs.map((program) => (
            <option key={program.id} value={program.id}>{program.title}</option>
          ))}
        </select>
      </label>
      {selectedProgramId ? <ProgramFinancesData slug={slug} programId={selectedProgramId} mode="admin" /> : null}
    </section>
  );
}

export function TeacherInstructorsData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [isDirector, setIsDirector] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function load() {
      setLoading(true);
      setError(null);

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setProgram(null);
        setLoading(false);
        return;
      }

      const [{ data: programRow, error: programError }, { data: directorAllowed }] = await Promise.all([
        supabase.from("programs").select("*").eq("id", programId).eq("mosque_id", mosque.id).maybeSingle(),
        supabase.rpc("is_program_director", { check_program_id: programId }),
      ]);

      if (programError) {
        setError(programError.message);
        setLoading(false);
        return;
      }

      setProgram(programRow ?? null);
      setIsDirector(Boolean(directorAllowed));
      setLoading(false);
    }

    void load();
  }, [programId, slug]);

  if (loading) {
    return <ClassesLoadingPlaceholders count={1} />;
  }

  if (error) {
    return <EmptyState title="Could not load instructors" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This class may no longer be available." />;
  }

  if (!isDirector) {
    return <EmptyState title="Director access required" text="Only the program director can manage instructors for this class." />;
  }

  return (
    <div className="bg-white p-4">
      <ProgramTeacherStaffTools program={program} />
    </div>
  );
}

export function TeacherProgramCreateData({ slug }: { slug: string }) {
  const [creatorAccountType, setCreatorAccountType] = useState<string | null>(null);
  const [directorOptions, setDirectorOptions] = useState<Array<Pick<Profile, "id" | "full_name" | "email">>>([]);
  const [selectedDirectorId, setSelectedDirectorId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [allAges, setAllAges] = useState(true);
  const [ageStart, setAgeStart] = useState("");
  const [ageEnd, setAgeEnd] = useState("");
  const [audienceGender, setAudienceGender] = useState("all");
  const [isPaid, setIsPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [learningVisible, setLearningVisible] = useState(true);
  const [learningTitle, setLearningTitle] = useState("What You Will Learn");
  const [learningIntro, setLearningIntro] = useState("");
  const [outcomeRows, setOutcomeRows] = useState<Array<{ id: string; text: string }>>([{ id: crypto.randomUUID(), text: "Add a learning outcome" }]);
  const [faqRows, setFaqRows] = useState<ProgramEditorFaqRow[]>(defaultProgramFaqRows);
  const [mediaRows, setMediaRows] = useState<ProgramEditorMediaRow[]>([]);
  const [trackRows, setTrackRows] = useState<Array<{ id: string; name: string; sessions: ProgramScheduleRow[] }>>([
    { id: crypto.randomUUID(), name: "Main Track", sessions: [{ day: "Monday", start: "18:00", end: "20:00" }] },
  ]);
  const [trackSelectionMode, setTrackSelectionMode] = useState<TrackSelectionMode>("exact");
  const [trackSelectionCount, setTrackSelectionCount] = useState(1);
  const [instructorDisplayName, setInstructorDisplayName] = useState("");
  const [instructorCredentials, setInstructorCredentials] = useState("");
  const [instructorContactPhone, setInstructorContactPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadDefaults() {
      const session = await loadCachedSession();
      if (!session?.user.id) {
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("profiles")
        .select("full_name, phone_number, teacher_whatsapp_number, account_type")
        .eq("id", session.user.id)
        .maybeSingle();
      setCreatorAccountType(data?.account_type ?? null);
      setInstructorDisplayName(data?.full_name ?? "");
      setInstructorContactPhone(data?.phone_number ?? data?.teacher_whatsapp_number ?? "");
      if (data?.account_type === "admin") {
        const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
        if (!mosque) {
          return;
        }
        const { data: teacherMemberships } = await supabase
          .from("mosque_memberships")
          .select("profile_id")
          .eq("mosque_id", mosque.id)
          .eq("role", "teacher")
          .eq("status", "active");
        const teacherIds = (teacherMemberships ?? []).map((membership) => membership.profile_id);
        const { data: teachers } = teacherIds.length
          ? await supabase.from("profiles").select("id, full_name, email").eq("account_type", "teacher").in("id", teacherIds).order("full_name", { ascending: true })
          : { data: [] as Array<Pick<Profile, "id" | "full_name" | "email">> };
        setDirectorOptions(teachers ?? []);
        setSelectedDirectorId((current) => current || teachers?.[0]?.id || "");
      }
    }

    void loadDefaults();
  }, [slug]);

  function handleThumbnailFile(file: File | null) {
    if (!file) {
      return;
    }
    setThumbnailFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setThumbnailUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function addTrack() {
    setTrackRows((current) => [...current, { id: crypto.randomUUID(), name: "New Track", sessions: [{ day: "Monday", start: "18:00", end: "20:00" }] }]);
  }

  function addMedia() {
    setMediaRows((current) => [...current, { id: crypto.randomUUID(), url: "", title: "", mediaType: "photo", file: null }]);
  }

  function setCreateMediaFile(rowId: string, file: File | null) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setMediaRows((current) =>
        current.map((row) => row.id === rowId ? { ...row, file, previewUrl: typeof reader.result === "string" ? reader.result : row.previewUrl } : row),
      );
    };
    reader.readAsDataURL(file);
  }

  async function uploadFile(programId: string, file: File) {
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      throw new Error("Log in required.");
    }
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/programs/${programId}/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    const result = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !result.url) {
      throw new Error(result.error ?? "Could not upload media.");
    }
    return result.url;
  }

  async function saveNewProgram() {
    setMessage(null);
    setToast(null);
    if (!title.trim()) {
      setToast({ tone: "error", message: "Class title is required." });
      return;
    }
    if (creatorAccountType === "admin" && !selectedDirectorId) {
      setToast({ tone: "error", message: "Choose a teacher director for this class." });
      return;
    }
    if (learningVisible && !learningTitle.trim()) {
      setToast({ tone: "error", message: "Learning section title cannot be blank." });
      return;
    }
    if (learningVisible && outcomeRows.some((row) => !row.text.trim())) {
      setToast({ tone: "error", message: "Checklist points cannot be blank." });
      return;
    }
    if (faqRows.some((row) => !row.question.trim() || !row.answer.trim())) {
      setToast({ tone: "error", message: "FAQ questions and answers cannot be blank." });
      return;
    }
    if (trackRows.some((track) => !track.name.trim() || track.sessions.some((session) => session.end <= session.start))) {
      setToast({ tone: "error", message: "Each track needs a name and an end time after start time." });
      return;
    }
    const savedTrackSelectionCount = Math.min(Math.max(1, trackSelectionCount), Math.max(1, trackRows.length));
    if (savedTrackSelectionCount < 1 || savedTrackSelectionCount > trackRows.length) {
      setToast({ tone: "error", message: "Track selection amount must fit the number of available tracks." });
      return;
    }

    setBusy(true);
    try {
      const accessToken = await getCurrentAccessToken();
      if (!accessToken) {
        throw new Error("Log in required.");
      }
      const schedule = trackRows[0]?.sessions as unknown as Json;
      const response = await fetch("/api/programs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          mosqueSlug: slug,
          title: title.trim(),
          description: description.trim() || null,
          thumbnailUrl: thumbnailFile ? null : thumbnailUrl.trim() || null,
          audienceGender,
          ageRangeText: allAges ? null : formatAgeRangeForSave(ageStart, ageEnd),
          isPaid,
          priceMonthlyCents: isPaid ? Math.max(0, Math.round(Number(price || "0") * 100)) : null,
          schedule,
          scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          trackSelectionMode,
          trackSelectionCount: savedTrackSelectionCount,
          directorProfileId: creatorAccountType === "admin" ? selectedDirectorId : null,
        }),
      });
      const result = (await response.json()) as { program?: Program; error?: string };
      if (!response.ok || !result.program) {
        throw new Error(result.error ?? "Could not create class.");
      }

      const program = result.program;
      let nextThumbnailUrl = thumbnailUrl;
      if (thumbnailFile) {
        nextThumbnailUrl = await uploadFile(program.id, thumbnailFile);
        const thumbnailResponse = await fetch(`/api/programs/${program.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            title: program.title,
            description: program.description,
            thumbnailUrl: nextThumbnailUrl,
            audienceGender: program.audience_gender,
            ageRangeText: program.age_range_text,
            isPaid: program.is_paid,
            priceMonthlyCents: program.price_monthly_cents,
            schedule: program.schedule,
            scheduleTimezone: program.schedule_timezone,
            scheduleNotes: program.schedule_notes,
            trackSelectionMode,
            trackSelectionCount: savedTrackSelectionCount,
          }),
        });
        const thumbnailResult = (await thumbnailResponse.json()) as { error?: string };
        if (!thumbnailResponse.ok) {
          throw new Error(thumbnailResult.error ?? "Could not save thumbnail.");
        }
      }

      const supabase = createSupabaseBrowserClient();
      const { error: detailsError } = await supabase.from("program_details").upsert({
        program_id: program.id,
        learning_title: learningVisible ? learningTitle.trim() : "What You Will Learn",
        learning_intro: learningVisible ? learningIntro.trim() || null : null,
        instructor_display_name: instructorDisplayName.trim() || null,
        instructor_credentials: instructorCredentials.trim() || null,
        instructor_contact_phone: instructorContactPhone.trim() || null,
      }, { onConflict: "program_id" });
      if (detailsError) {
        throw new Error(detailsError.message);
      }

      if (learningVisible && outcomeRows.length) {
        const { error: outcomesError } = await supabase.from("program_outcomes").insert(outcomeRows.map((row, index) => ({ program_id: program.id, sort_order: index + 1, text: row.text.trim() })));
        if (outcomesError) {
          throw new Error(outcomesError.message);
        }
      }
      if (faqRows.length) {
        const { error: faqsError } = await supabase.from("program_faqs").insert(
          faqRows.map((row, index) => ({
            program_id: program.id,
            sort_order: index + 1,
            question: row.question.trim(),
            answer: row.answer.trim(),
          })),
        );
        if (faqsError) {
          throw new Error(faqsError.message);
        }
      }
      const { error: tracksError } = await supabase.from("program_tracks").insert(trackRows.map((track, index) => ({ program_id: program.id, sort_order: index + 1, name: track.name.trim(), description: null, schedule: track.sessions as unknown as Json, is_active: true })));
      if (tracksError) {
        throw new Error(tracksError.message);
      }

      const uploadedMedia = [];
      for (const [index, row] of mediaRows.entries()) {
        if (!row.file) {
          continue;
        }
        const url = await uploadFile(program.id, row.file);
        uploadedMedia.push({ program_id: program.id, sort_order: index + 1, media_type: "photo", url, thumbnail_url: url, title: row.title.trim() || null, short_label: row.title.trim() || null });
      }
      if (uploadedMedia.length) {
        const { error: mediaError } = await supabase.from("program_media").insert(uploadedMedia);
        if (mediaError) {
          throw new Error(mediaError.message);
        }
      }

      mosqueProgramsCache.delete(slug);
      window.dispatchEvent(new Event("tareeqah:programs-changed"));
      queueEditorToast({ tone: "success", message: "Class created successfully." });
      window.location.href = creatorAccountType === "admin" ? `/m/${slug}/admin/programs` : `/m/${slug}/teacher/classes`;
    } catch (error) {
      setToast({ tone: "error", message: error instanceof Error ? error.message : "Could not create class." });
      setBusy(false);
    }
  }

  if (previewOpen) {
    return (
      <ProgramEditorPreview
        program={buildProgramPreview({
          id: "new",
          title: title || "New Class",
          description,
          thumbnailUrl,
          audienceGender,
          ageRangeText: allAges ? null : formatAgeRangeForSave(ageStart, ageEnd),
          isPaid,
          priceMonthlyCents: isPaid ? Math.max(0, Math.round(Number(price || "0") * 100)) : null,
          schedule: trackRows[0]?.sessions as unknown as Json,
          trackSelectionMode,
          trackSelectionCount,
        })}
        learningTitle={learningVisible ? learningTitle : ""}
        learningIntro={learningVisible ? learningIntro : ""}
        outcomes={learningVisible ? outcomeRows.map((row) => row.text).filter((text) => text.trim()) : []}
        faqRows={faqRows}
        mediaRows={mediaRows}
        trackRows={trackRows}
        instructorDisplayName={instructorDisplayName}
        instructorCredentials={instructorCredentials}
        instructorContactPhone={instructorContactPhone}
        onBack={() => setPreviewOpen(false)}
      />
    );
  }

  return (
    <div className="space-y-5 bg-[var(--workspace)] p-4 pb-40">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
        <div className="relative">
          <ProgramHero program={{ id: "new", mosque_id: "", teacher_profile_id: null, director_profile_id: null, title: title || "New Class", description: description || null, is_active: true, is_paid: isPaid, thumbnail_url: thumbnailUrl || null, price_monthly_cents: null, stripe_product_id: null, stripe_price_id: null, audience_gender: audienceGender, age_range_text: allAges ? null : formatAgeRangeForSave(ageStart, ageEnd), schedule: null, schedule_timezone: null, schedule_notes: null, track_selection_mode: trackSelectionMode, track_selection_count: trackSelectionCount, tags: null, created_at: "", updated_at: "" }} />
          <input ref={thumbnailInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleThumbnailFile(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => thumbnailInputRef.current?.click()} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#26323A] shadow-lg" aria-label="Upload thumbnail">
            <PhotoIcon />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <EditBox label="Title" required value={title} onChange={setTitle} />
          <EditBox label="Description" value={description} onChange={setDescription} multiline />
        </div>
      </section>

      {creatorAccountType === "admin" ? (
        <section className="space-y-2 bg-white px-4 py-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[#6B747B]" htmlFor="program-director">
            Class Director
          </label>
          <select
            id="program-director"
            value={selectedDirectorId}
            onChange={(event) => setSelectedDirectorId(event.target.value)}
            className="h-12 w-full rounded-[10px] border border-[#B9C3C8] bg-white px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]"
          >
            {directorOptions.length ? (
              directorOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.full_name || teacher.email || "Unnamed teacher"}
                </option>
              ))
            ) : (
              <option value="">No active teachers found</option>
            )}
          </select>
        </section>
      ) : null}

      <ProgramEditorFields
        learningVisible={learningVisible}
        setLearningVisible={setLearningVisible}
        learningTitle={learningTitle}
        setLearningTitle={setLearningTitle}
        learningIntro={learningIntro}
        setLearningIntro={setLearningIntro}
        outcomeRows={outcomeRows}
        setOutcomeRows={setOutcomeRows}
        faqRows={faqRows}
        setFaqRows={setFaqRows}
        mediaRows={mediaRows}
        setMediaRows={setMediaRows}
        onMediaFile={setCreateMediaFile}
        addMedia={addMedia}
        trackRows={trackRows}
        setTrackRows={setTrackRows}
        addTrack={addTrack}
        trackSelectionMode={trackSelectionMode}
        setTrackSelectionMode={setTrackSelectionMode}
        trackSelectionCount={trackSelectionCount}
        setTrackSelectionCount={setTrackSelectionCount}
        allAges={allAges}
        setAllAges={setAllAges}
        ageStart={ageStart}
        setAgeStart={setAgeStart}
        ageEnd={ageEnd}
        setAgeEnd={setAgeEnd}
        audienceGender={audienceGender}
        setAudienceGender={setAudienceGender}
        isPaid={isPaid}
        setIsPaid={setIsPaid}
        price={price}
        setPrice={setPrice}
        instructorDisplayName={instructorDisplayName}
        setInstructorDisplayName={setInstructorDisplayName}
        instructorCredentials={instructorCredentials}
        setInstructorCredentials={setInstructorCredentials}
        instructorContactPhone={instructorContactPhone}
        setInstructorContactPhone={setInstructorContactPhone}
      />

      <div className="sticky bottom-[92px] z-10 space-y-2 bg-white py-2 md:bottom-4">
        {message ? <p className="text-sm font-medium text-[#52616A]">{message}</p> : null}
        <div className="grid grid-cols-[0.9fr_1.1fr] gap-2">
          <button type="button" disabled={busy} onClick={() => setPreviewOpen(true)} className="min-h-11 rounded-[10px] border border-[#B9C3C8] bg-white px-4 text-sm font-semibold text-[#26323A] disabled:opacity-60">
            Preview page
          </button>
          <button type="button" disabled={busy} onClick={saveNewProgram} className="min-h-11 rounded-[10px] bg-[#17624F] px-5 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Creating..." : "Create class"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeacherProgramSettingsData({ slug, programId, returnHref }: { slug: string; programId: string; returnHref?: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [details, setDetails] = useState<ProgramDetails | null>(null);
  const [isDirector, setIsDirector] = useState(false);
  const [isAdminEditor, setIsAdminEditor] = useState(false);
  const [directorOptions, setDirectorOptions] = useState<Array<Pick<Profile, "id" | "full_name" | "email">>>([]);
  const [selectedDirectorId, setSelectedDirectorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [allAges, setAllAges] = useState(true);
  const [ageStart, setAgeStart] = useState("");
  const [ageEnd, setAgeEnd] = useState("");
  const [audienceGender, setAudienceGender] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [learningVisible, setLearningVisible] = useState(true);
  const [learningTitle, setLearningTitle] = useState("What You Will Learn");
  const [learningIntro, setLearningIntro] = useState("");
  const [outcomeRows, setOutcomeRows] = useState<Array<{ id: string; text: string }>>([]);
  const [faqRows, setFaqRows] = useState<ProgramEditorFaqRow[]>(defaultProgramFaqRows);
  const [mediaRows, setMediaRows] = useState<Array<{ id: string; url: string; title: string; mediaType: string }>>([]);
  const [trackRows, setTrackRows] = useState<Array<{ id: string; name: string; sessions: ProgramScheduleRow[] }>>([]);
  const [trackSelectionMode, setTrackSelectionMode] = useState<TrackSelectionMode>("exact");
  const [trackSelectionCount, setTrackSelectionCount] = useState(1);
  const [instructorDisplayName, setInstructorDisplayName] = useState("");
  const [instructorCredentials, setInstructorCredentials] = useState("");
  const [instructorContactPhone, setInstructorContactPhone] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [initialEditorSignature, setInitialEditorSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function load() {
      setLoading(true);
      setError(null);

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setProgram(null);
        setLoading(false);
        return;
      }

      const [{ data: programRow, error: programError }, { data: directorAllowed }, detailResult, outcomeResult, faqResult, mediaResult, trackResult] = await Promise.all([
        supabase.from("programs").select("*").eq("id", programId).eq("mosque_id", mosque.id).maybeSingle(),
        supabase.rpc("is_program_director", { check_program_id: programId }),
        supabase.from("program_details").select("*").eq("program_id", programId).maybeSingle(),
        supabase.from("program_outcomes").select("*").eq("program_id", programId).order("sort_order", { ascending: true }),
        supabase.from("program_faqs").select("*").eq("program_id", programId).order("sort_order", { ascending: true }),
        supabase.from("program_media").select("*").eq("program_id", programId).order("sort_order", { ascending: true }),
        supabase.from("program_tracks").select("*").eq("program_id", programId).order("sort_order", { ascending: true }),
      ]);

      if (programError) {
        setError(programError.message);
        setLoading(false);
        return;
      }

      setProgram(programRow ?? null);
      setDetails(detailResult.data ?? null);
      setIsDirector(Boolean(directorAllowed));
      setIsAdminEditor(false);
      setDirectorOptions([]);
      if (programRow) {
        const directorProfileId = programRow.director_profile_id ?? programRow.teacher_profile_id;
        setSelectedDirectorId(directorProfileId ?? "");
        const session = await loadCachedSession();
        const viewerId = session?.user.id ?? null;
        if (viewerId) {
          const [{ data: viewerProfile }, { data: adminMembership }] = await Promise.all([
            supabase.from("profiles").select("account_type").eq("id", viewerId).maybeSingle(),
            supabase
              .from("mosque_memberships")
              .select("id")
              .eq("mosque_id", mosque.id)
              .eq("profile_id", viewerId)
              .eq("role", "admin")
              .eq("status", "active")
              .maybeSingle(),
          ]);
          const nextIsAdminEditor = viewerProfile?.account_type === "admin" && Boolean(adminMembership);
          setIsAdminEditor(nextIsAdminEditor);
          if (nextIsAdminEditor) {
            const { data: teacherMemberships } = await supabase
              .from("mosque_memberships")
              .select("profile_id")
              .eq("mosque_id", mosque.id)
              .eq("role", "teacher")
              .eq("status", "active");
            const teacherIds = Array.from(new Set((teacherMemberships ?? []).map((membership) => membership.profile_id).filter(Boolean))) as string[];
            if (teacherIds.length) {
              const { data: teachers } = await supabase
                .from("profiles")
                .select("id, full_name, email")
                .in("id", teacherIds)
                .eq("account_type", "teacher")
                .order("full_name", { ascending: true });
              setDirectorOptions(teachers ?? []);
            }
          }
        }
        const { data: directorProfile } = directorProfileId
          ? await supabase.from("profiles").select("full_name, teacher_credentials, teacher_whatsapp_number").eq("id", directorProfileId).maybeSingle()
          : { data: null };
        const rows = parseProgramSchedule(programRow.schedule);
        const firstRow = rows[0];
        const parsedAge = parseAgeRangeForEdit(programRow.age_range_text);
        const nextLearningVisible = Boolean(detailResult.data || (outcomeResult.data ?? []).length);
        const nextLearningTitle = detailResult.data?.learning_title?.trim() || "What You Will Learn";
        const nextLearningIntro = detailResult.data?.learning_intro ?? "";
        const nextInstructorDisplayName = detailResult.data?.instructor_display_name ?? directorProfile?.full_name ?? "";
        const nextInstructorCredentials = detailResult.data?.instructor_credentials ?? "";
        const nextInstructorContactPhone = detailResult.data?.instructor_contact_phone ?? directorProfile?.teacher_whatsapp_number ?? "";
        const nextTrackSelectionMode = normalizeTrackSelectionMode(programRow.track_selection_mode);
        const nextTrackSelectionCount = programRow.track_selection_count ?? 1;
        const nextOutcomeRows = (outcomeResult.data ?? []).map((row) => ({ id: row.id, text: row.text }));
        const nextFaqRows = (faqResult.data ?? []).length
          ? (faqResult.data ?? []).map((row) => ({ id: row.id, question: row.question, answer: row.answer }))
          : defaultProgramFaqRows;
        const nextMediaRows = (mediaResult.data ?? []).map((row) => ({ id: row.id, url: row.url, title: row.title ?? "", mediaType: row.media_type }));
        const nextTrackRows =
          (trackResult.data ?? []).length
            ? (trackResult.data ?? []).map((track) => {
                const trackSchedule = parseProgramSchedule(track.schedule);
                return {
                  id: track.id,
                  name: track.name,
                  sessions: trackSchedule.length ? trackSchedule : [firstRow ?? { day: "Monday", start: "18:00", end: "20:00" }],
                };
              })
            : [
                {
                  id: "default",
                  name: "Main Track",
                  sessions: [firstRow ?? { day: "Monday", start: "18:00", end: "20:00" }],
                },
              ];
        setTitle(programRow.title);
        setDescription(programRow.description ?? "");
        setThumbnailUrl(programRow.thumbnail_url ?? "");
        setAllAges(parsedAge.allAges);
        setAgeStart(parsedAge.start);
        setAgeEnd(parsedAge.end);
        setAudienceGender(normalizeAudienceGender(programRow.audience_gender));
        setIsPaid(Boolean(programRow.is_paid));
        setPrice(programRow.price_monthly_cents ? String(programRow.price_monthly_cents / 100) : "");
        setLearningVisible(nextLearningVisible);
        setLearningTitle(nextLearningTitle);
        setLearningIntro(nextLearningIntro);
        setInstructorDisplayName(nextInstructorDisplayName);
        setInstructorCredentials(nextInstructorCredentials);
        setInstructorContactPhone(nextInstructorContactPhone);
        setTrackSelectionMode(nextTrackSelectionMode);
        setTrackSelectionCount(nextTrackSelectionCount);
        setOutcomeRows(nextOutcomeRows);
        setFaqRows(nextFaqRows);
        setMediaRows(nextMediaRows);
        setTrackRows(nextTrackRows);
        setInitialEditorSignature(serializeProgramEditorState({
          title: programRow.title,
          description: programRow.description ?? "",
          thumbnailUrl: programRow.thumbnail_url ?? "",
          allAges: parsedAge.allAges,
          ageStart: parsedAge.start,
          ageEnd: parsedAge.end,
          audienceGender: normalizeAudienceGender(programRow.audience_gender),
          isPaid: Boolean(programRow.is_paid),
          price: programRow.price_monthly_cents ? String(programRow.price_monthly_cents / 100) : "",
          learningVisible: nextLearningVisible,
          learningTitle: nextLearningTitle,
          learningIntro: nextLearningIntro,
          outcomeRows: nextOutcomeRows,
          faqRows: nextFaqRows,
          mediaRows: nextMediaRows,
          trackRows: nextTrackRows,
          trackSelectionMode: nextTrackSelectionMode,
          trackSelectionCount: nextTrackSelectionCount,
          selectedDirectorId: directorProfileId ?? "",
          instructorDisplayName: nextInstructorDisplayName,
          instructorCredentials: nextInstructorCredentials,
          instructorContactPhone: nextInstructorContactPhone,
        }));
      }
      setLoading(false);
    }

    void load();
  }, [programId, slug]);

  function handleThumbnailFile(file: File | null) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setThumbnailUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function addLearningSection() {
    setLearningVisible(true);
    setLearningTitle("What You Will Learn");
    setLearningIntro("Describe what students will gain from this program.");
    setOutcomeRows([{ id: crypto.randomUUID(), text: "Add a learning outcome" }]);
  }

  function addTrack() {
    setTrackRows((current) => [
      ...current,
      { id: crypto.randomUUID(), name: "New Track", sessions: [{ day: "Monday", start: "18:00", end: "20:00" }] },
    ]);
  }

  function addMedia() {
    setMediaRows((current) => [...current, { id: crypto.randomUUID(), url: "", title: "", mediaType: "photo" }]);
  }

  async function uploadProgramMedia(rowId: string, file: File | null) {
    if (!program || !file) {
      return;
    }

    setBusy(true);
    setMessage(null);
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      setBusy(false);
      setMessage("Log in required.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/programs/${program.id}/media/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });
    const result = (await response.json()) as { url?: string; error?: string };
    setBusy(false);
    if (!response.ok || !result.url) {
      setMessage(result.error ?? "Could not upload media.");
      return;
    }

    setMediaRows((current) => current.map((row) => row.id === rowId ? { ...row, url: result.url ?? row.url, mediaType: "photo" } : row));
    setMessage("Photo uploaded. Save changes to publish it.");
  }

  async function saveProgram() {
    if (!program) {
      return;
    }

    setMessage(null);
    setToast(null);
    if (!title.trim()) {
      setToast({ tone: "error", message: "Class title is required." });
      return;
    }

    if (learningVisible && !learningTitle.trim()) {
      setToast({ tone: "error", message: "Learning section title cannot be blank." });
      return;
    }

    if (learningVisible && outcomeRows.some((row) => !row.text.trim())) {
      setToast({ tone: "error", message: "Checklist points cannot be blank." });
      return;
    }

    if (faqRows.some((row) => !row.question.trim() || !row.answer.trim())) {
      setToast({ tone: "error", message: "FAQ questions and answers cannot be blank." });
      return;
    }

    if (trackRows.some((track) => !track.name.trim() || track.sessions.length === 0 || track.sessions.some((session) => session.end <= session.start))) {
      setToast({ tone: "error", message: "Each track needs a name and an end time after the start time." });
      return;
    }
    if (isAdminEditor && !selectedDirectorId) {
      setToast({ tone: "error", message: "Choose a director for this class." });
      return;
    }
    const savedTrackSelectionCount = Math.min(Math.max(1, trackSelectionCount), Math.max(1, trackRows.length));
    if (savedTrackSelectionCount < 1 || savedTrackSelectionCount > trackRows.length) {
      setToast({ tone: "error", message: "Track selection amount must fit the number of available tracks." });
      return;
    }

    setBusy(true);
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      setToast({ tone: "error", message: "Log in required." });
      setBusy(false);
      return;
    }

    const nextAgeRangeText = allAges ? null : formatAgeRangeForSave(ageStart, ageEnd);
    const schedule = trackRows[0] ? (trackRows[0].sessions as unknown as Json) : null;
    const response = await fetch(`/api/programs/${program.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        thumbnailUrl: thumbnailUrl.trim() || null,
        audienceGender: audienceGender || null,
        ageRangeText: nextAgeRangeText,
        isPaid,
        priceMonthlyCents: isPaid ? Math.max(0, Math.round(Number(price || "0") * 100)) : null,
        schedule,
        scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        scheduleNotes: null,
        trackSelectionMode,
        trackSelectionCount: savedTrackSelectionCount,
        directorProfileId: isAdminEditor ? selectedDirectorId : null,
      }),
    });

    const result = (await response.json()) as { program?: Program; error?: string };
    if (!response.ok || !result.program) {
      setToast({ tone: "error", message: result.error ?? "Could not save class." });
      setBusy(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const detailsPayload = {
      program_id: program.id,
      learning_title: learningVisible ? learningTitle.trim() : "What You Will Learn",
      learning_intro: learningVisible ? learningIntro.trim() || null : null,
      instructor_display_name: instructorDisplayName.trim() || null,
      instructor_credentials: instructorCredentials.trim() || null,
      instructor_contact_phone: instructorContactPhone.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: detailsError } = await supabase.from("program_details").upsert(detailsPayload, { onConflict: "program_id" });
    if (detailsError) {
      setToast({ tone: "error", message: detailsError.message });
      setBusy(false);
      return;
    }

    await supabase.from("program_outcomes").delete().eq("program_id", program.id);
    if (learningVisible && outcomeRows.length) {
      const { error: outcomesError } = await supabase.from("program_outcomes").insert(
        outcomeRows.map((row, index) => ({
          program_id: program.id,
          sort_order: index + 1,
          text: row.text.trim(),
        })),
      );
      if (outcomesError) {
        setToast({ tone: "error", message: outcomesError.message });
        setBusy(false);
        return;
      }
    }

    await supabase.from("program_faqs").delete().eq("program_id", program.id);
    if (faqRows.length) {
      const { error: faqsError } = await supabase.from("program_faqs").insert(
        faqRows.map((row, index) => ({
          program_id: program.id,
          sort_order: index + 1,
          question: row.question.trim(),
          answer: row.answer.trim(),
        })),
      );
      if (faqsError) {
        setToast({ tone: "error", message: faqsError.message });
        setBusy(false);
        return;
      }
    }

    await supabase.from("program_media").delete().eq("program_id", program.id);
    const filledMediaRows = mediaRows.filter((row) => row.url.trim());
    if (filledMediaRows.length) {
      const { error: mediaError } = await supabase.from("program_media").insert(
        filledMediaRows.map((row, index) => ({
          program_id: program.id,
          sort_order: index + 1,
          media_type: row.mediaType === "video" ? "video" : "photo",
          url: row.url.trim(),
          thumbnail_url: row.url.trim(),
          title: row.title.trim() || null,
          short_label: row.title.trim() || null,
        })),
      );
      if (mediaError) {
        setToast({ tone: "error", message: mediaError.message });
        setBusy(false);
        return;
      }
    }

    await supabase.from("program_tracks").delete().eq("program_id", program.id);
    if (trackRows.length) {
      const { error: tracksError } = await supabase.from("program_tracks").insert(
        trackRows.map((track, index) => ({
          program_id: program.id,
          sort_order: index + 1,
          name: track.name.trim(),
          description: null,
          schedule: track.sessions as unknown as Json,
          is_active: true,
        })),
      );
      if (tracksError) {
        setToast({ tone: "error", message: tracksError.message });
        setBusy(false);
        return;
      }
    }

    setProgram(result.program);
    setDetails(detailsPayload as ProgramDetails);
    mosqueProgramsCache.delete(slug);
    window.dispatchEvent(new Event("tareeqah:programs-changed"));
    queueEditorToast({ tone: "success", message: "Changes saved successfully." });
    window.location.href = returnHref ?? `/m/${slug}/teacher/classes`;
  }

  async function deleteProgram() {
    if (!program || deleteText !== program.title) {
      setMessage(`Type "${program?.title ?? "the class title"}" exactly to delete this class.`);
      return;
    }

    setBusy(true);
    setMessage(null);
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) {
      setMessage("Log in required.");
      setBusy(false);
      return;
    }

    const response = await fetch(`/api/programs/${program.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "Could not delete class.");
      return;
    }

    mosqueProgramsCache.clear();
    window.location.href = returnHref ?? `/m/${slug}/teacher/classes`;
  }

  if (loading) {
    return <ClassesLoadingPlaceholders count={1} />;
  }

  if (error) {
    return <EmptyState title="Could not load class settings" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This class may no longer be available." />;
  }

  if (!isDirector) {
    return <EmptyState title="Director access required" text="Only the program director can edit this class." />;
  }

  const currentEditorSignature = serializeProgramEditorState({
    title,
    description,
    thumbnailUrl,
    allAges,
    ageStart,
    ageEnd,
    audienceGender,
    isPaid,
    price,
    learningVisible,
    learningTitle,
    learningIntro,
    outcomeRows,
    faqRows,
    mediaRows,
    trackRows,
    trackSelectionMode,
    trackSelectionCount,
    selectedDirectorId: isAdminEditor ? selectedDirectorId : "",
    instructorDisplayName,
    instructorCredentials,
    instructorContactPhone,
  });
  const hasUnsavedChanges = initialEditorSignature !== null && currentEditorSignature !== initialEditorSignature;

  if (previewOpen) {
    return (
      <ProgramEditorPreview
        program={buildProgramPreview({
          id: program.id,
          title: title || program.title,
          description,
          thumbnailUrl,
          audienceGender,
          ageRangeText: allAges ? null : formatAgeRangeForSave(ageStart, ageEnd),
          isPaid,
          priceMonthlyCents: isPaid ? Math.max(0, Math.round(Number(price || "0") * 100)) : null,
          schedule: trackRows[0]?.sessions as unknown as Json,
          trackSelectionMode,
          trackSelectionCount,
          base: program,
        })}
        learningTitle={learningVisible ? learningTitle : ""}
        learningIntro={learningVisible ? learningIntro : ""}
        outcomes={learningVisible ? outcomeRows.map((row) => row.text).filter((text) => text.trim()) : []}
        faqRows={faqRows}
        mediaRows={mediaRows}
        trackRows={trackRows}
        instructorDisplayName={instructorDisplayName}
        instructorCredentials={instructorCredentials}
        instructorContactPhone={instructorContactPhone}
        onBack={() => setPreviewOpen(false)}
      />
    );
  }

  return (
    <div className="space-y-5 bg-[var(--workspace)] p-4 pb-40">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
        <div className="relative">
          <ProgramHero program={{ ...program, title, thumbnail_url: thumbnailUrl || null }} />
          <input ref={thumbnailInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleThumbnailFile(event.target.files?.[0] ?? null)} />
          <div className="absolute right-3 top-3 flex gap-2">
            <button type="button" onClick={() => thumbnailInputRef.current?.click()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#26323A] shadow-lg" aria-label="Replace thumbnail">
              <PhotoIcon />
            </button>
            {thumbnailUrl ? (
              <button type="button" onClick={() => setThumbnailUrl("")} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#C83F31] shadow-lg" aria-label="Remove thumbnail">
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="space-y-3 p-4">
          <EditBox label="Title" required value={title} onChange={setTitle} />
          <EditBox label="Description" value={description} onChange={setDescription} multiline />
        </div>
      </section>

      {isAdminEditor ? (
        <DetailSection title="Class Director">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B747B]">Director</span>
            <select value={selectedDirectorId} onChange={(event) => setSelectedDirectorId(event.target.value)} className="h-11 w-full rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]">
              <option value="">Choose director</option>
              {directorOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.full_name || teacher.email || "Teacher"}
                </option>
              ))}
            </select>
          </label>
        </DetailSection>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="space-y-5">
          {learningVisible ? (
            <DetailSection title="Learning Section">
              <div className="space-y-4">
                <EditBox label="Section title" required value={learningTitle} onChange={setLearningTitle} />
                <EditBox label="Section description" value={learningIntro} onChange={setLearningIntro} multiline />
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[#26323A]">Checklist</p>
                  {outcomeRows.map((row, index) => (
                    <div key={row.id} className="flex items-start gap-2 border-t border-[#E6ECEF] pt-2 first:border-t-0 first:pt-0">
                      <textarea
                        value={row.text}
                        onChange={(event) => setOutcomeRows((current) => current.map((item) => item.id === row.id ? { ...item, text: event.target.value } : item))}
                        className="min-h-16 min-w-0 flex-1 resize-y rounded-[8px] border border-[#B9C3C8] px-3 py-2 text-sm leading-6 outline-none focus:border-[#2F8FB3]"
                        aria-label={`Checklist point ${index + 1}`}
                      />
                      <button type="button" onClick={() => setOutcomeRows((current) => current.filter((item) => item.id !== row.id))} className="h-11 rounded-[8px] border border-[#E1C3BF] px-3 text-sm font-semibold text-[#C83F31]">
                        Delete
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setOutcomeRows((current) => [...current, { id: crypto.randomUUID(), text: "New checklist point" }])} className="min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
                    Add point
                  </button>
                </div>
                <button type="button" onClick={() => window.confirm("Delete the learning section?") && setLearningVisible(false)} className="min-h-10 rounded-[8px] border border-[#C83F31] px-4 text-sm font-semibold text-[#C83F31]">
                  Delete learning section
                </button>
              </div>
            </DetailSection>
          ) : (
            <button type="button" onClick={addLearningSection} className="min-h-28 w-full rounded-[22px] border border-dashed border-[#9EB4BD] bg-white text-sm font-semibold text-[#2F6077]">
              Add checklist section
            </button>
          )}

          <ProgramFaqEditor faqRows={faqRows} onChange={setFaqRows} />

          <DetailSection title="Program Media">
            <div className="divide-y divide-[#E6ECEF]">
              {mediaRows.map((row) => (
                <div key={row.id} className="grid gap-2 py-3 first:pt-0">
                  {row.url ? (
                    <div className="relative h-32 overflow-hidden rounded-[14px] bg-[#E7EEF2]">
                      <Image src={row.url} alt="" fill className="object-cover" sizes="320px" />
                    </div>
                  ) : null}
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[8px] border border-[#D6DCE0] bg-white px-3 text-sm font-semibold text-[#26323A]">
                    {row.url ? "Replace photo" : "Upload photo"}
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadProgramMedia(row.id, event.target.files?.[0] ?? null)} />
                  </label>
                  <input value={row.title} onChange={(event) => setMediaRows((current) => current.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} placeholder="Optional title" className="h-10 rounded-[8px] border border-[#B9C3C8] px-3 text-sm" />
                  <button type="button" onClick={() => setMediaRows((current) => current.filter((item) => item.id !== row.id))} className="justify-self-start text-sm font-semibold text-[#C83F31]">Remove</button>
                </div>
              ))}
              <button type="button" onClick={addMedia} className="min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
                Add media
              </button>
            </div>
          </DetailSection>

          <DetailSection title="Schedule Tracks">
            <div className="divide-y divide-[#E6ECEF]">
              <TrackSelectionRuleFields
                trackCount={trackRows.length}
                mode={trackSelectionMode}
                count={trackSelectionCount}
                onModeChange={setTrackSelectionMode}
                onCountChange={setTrackSelectionCount}
              />
              {trackRows.map((track) => (
                <div key={track.id} className="space-y-3 py-4 first:pt-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_36px] items-end gap-2">
                    <EditBox label="Track name" required value={track.name} onChange={(value) => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, name: value } : item))} />
                    {trackRows.length > 1 ? (
                      <button type="button" onClick={() => setTrackRows((current) => current.filter((item) => item.id !== track.id))} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#C83F31] hover:bg-[#FDEDEA]" aria-label="Remove track">
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Times</p>
                    {track.sessions.map((session, sessionIndex) => (
                      <div key={`${track.id}-${sessionIndex}`} className="grid grid-cols-[90px_8px_84px_16px_84px_28px] items-center gap-1">
                        <select
                          value={session.day}
                          onChange={(event) =>
                            setTrackRows((current) =>
                              current.map((item) =>
                                item.id === track.id
                                  ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, day: event.target.value as (typeof scheduleDayOptions)[number] } : row) }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                        >
                          {scheduleDayOptions.map((day) => <option key={day} value={day}>{day}</option>)}
                        </select>
                        <span className="text-sm font-semibold text-[#6B747B]">-</span>
                        <select
                          value={session.start}
                          onChange={(event) =>
                            setTrackRows((current) =>
                              current.map((item) =>
                                item.id === track.id
                                  ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, start: event.target.value } : row) }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                        >
                          {scheduleTimeOptions.map((time) => <option key={time} value={time}>{formatClockLabel(time)}</option>)}
                        </select>
                        <span className="text-xs font-semibold text-[#6B747B]">to</span>
                        <select
                          value={session.end}
                          onChange={(event) =>
                            setTrackRows((current) =>
                              current.map((item) =>
                                item.id === track.id
                                  ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, end: event.target.value } : row) }
                                  : item,
                              ),
                            )
                          }
                          className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                        >
                          {scheduleTimeOptions.map((time) => <option key={time} value={time}>{formatClockLabel(time)}</option>)}
                        </select>
                        {track.sessions.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, sessions: item.sessions.filter((_row, index) => index !== sessionIndex) } : item))}
                            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[#C83F31] hover:bg-[#FDEDEA]"
                            aria-label="Remove time"
                          >
                            <TrashIcon />
                          </button>
                        ) : <span aria-hidden />}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, sessions: [...item.sessions, { day: "Monday", start: "18:00", end: "20:00" }] } : item))}
                      className="min-h-9 rounded-[8px] border border-[#D6DCE0] px-3 text-sm font-semibold text-[#26323A]"
                    >
                      Add time
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addTrack} className="mt-3 min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
                Add track
              </button>
            </div>
          </DetailSection>
        </div>

        <div className="space-y-4">
          <DetailSection title="Target Audience">
            <label className="flex items-center gap-2 text-sm font-medium text-[#26323A]">
              <input type="checkbox" checked={allAges} onChange={(event) => setAllAges(event.target.checked)} />
              All ages
            </label>
            {!allAges ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <EditBox label="From age" value={ageStart} onChange={setAgeStart} />
                <EditBox label="To age" value={ageEnd} onChange={setAgeEnd} />
              </div>
            ) : null}
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B747B]">Gender</span>
              <select value={audienceGender} onChange={(event) => setAudienceGender(event.target.value)} className="h-11 w-full rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]">
                <option value="all">All</option>
                <option value="brothers">Brothers only</option>
                <option value="sisters">Sisters only</option>
              </select>
            </label>
          </DetailSection>

          <DetailSection title="Price">
            <label className="flex items-center gap-2 text-sm font-medium text-[#26323A]">
              <input type="checkbox" checked={isPaid} onChange={(event) => setIsPaid(event.target.checked)} />
              Paid monthly program
            </label>
            {isPaid ? <div className="mt-3"><EditBox label="Monthly price" value={price} onChange={setPrice} /></div> : null}
          </DetailSection>

          <DetailSection title="Instructor Display">
            <div className="space-y-3">
              <EditBox label="Display name" value={instructorDisplayName} onChange={setInstructorDisplayName} />
              <EditBox label="Credentials" value={instructorCredentials} onChange={setInstructorCredentials} multiline />
              <EditBox label="Contact phone" value={instructorContactPhone} onChange={setInstructorContactPhone} />
            </div>
          </DetailSection>
        </div>
      </div>

      <div className="sticky bottom-[92px] z-10 space-y-2 bg-white py-2 md:bottom-4">
        {message ? <p className="text-sm font-medium text-[#52616A]">{message}</p> : null}
        <div className="grid grid-cols-[0.9fr_1.1fr] gap-2">
          <button type="button" disabled={busy} onClick={() => setPreviewOpen(true)} className="min-h-11 rounded-[10px] border border-[#B9C3C8] bg-white px-4 text-sm font-semibold text-[#26323A] disabled:opacity-60">
            Preview page
          </button>
          <button type="button" disabled={busy || !hasUnsavedChanges} onClick={saveProgram} className="min-h-11 rounded-[10px] bg-[#17624F] px-5 text-sm font-semibold text-white disabled:opacity-45">
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      <section className="space-y-3 rounded-[22px] border border-[#F0C0BA] bg-[#FFF8F7] p-4">
        <div>
          <h2 className="text-base font-semibold text-[#7A271F]">Delete Class</h2>
          <p className="mt-1 text-sm text-[#8A524B]">This permanently deletes the class and related class records.</p>
        </div>
        {!deleteOpen ? (
          <button type="button" onClick={() => setDeleteOpen(true)} className="min-h-10 rounded-[8px] border border-[#C83F31] bg-white px-4 text-sm font-semibold text-[#C83F31]">
            Delete class
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#7A271F]">
              Type <span className="font-semibold">{program.title}</span> to confirm.
            </p>
            <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} className="h-11 w-full rounded-[8px] border border-[#D4928A] bg-white px-3 text-sm outline-none focus:border-[#C83F31]" />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || deleteText !== program.title} onClick={deleteProgram} className="min-h-10 rounded-[8px] bg-[#C83F31] px-4 text-sm font-semibold text-white disabled:opacity-60">
                Permanently delete
              </button>
              <button type="button" disabled={busy} onClick={() => { setDeleteOpen(false); setDeleteText(""); }} className="min-h-10 rounded-[8px] border border-[#D6DCE0] bg-white px-4 text-sm font-semibold text-[#26323A] disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}

function buildProgramPreview({
  id,
  title,
  description,
  thumbnailUrl,
  audienceGender,
  ageRangeText,
  isPaid,
  priceMonthlyCents,
  schedule,
  trackSelectionMode,
  trackSelectionCount,
  base,
}: {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  audienceGender: string;
  ageRangeText: string | null;
  isPaid: boolean;
  priceMonthlyCents: number | null;
  schedule: Json | null;
  trackSelectionMode: TrackSelectionMode;
  trackSelectionCount: number;
  base?: Program;
}): Program {
  return {
    id,
    mosque_id: base?.mosque_id ?? "",
    teacher_profile_id: base?.teacher_profile_id ?? null,
    director_profile_id: base?.director_profile_id ?? null,
    title,
    description: description.trim() || null,
    is_active: true,
    is_paid: isPaid,
    thumbnail_url: thumbnailUrl.trim() || null,
    price_monthly_cents: isPaid ? priceMonthlyCents : null,
    stripe_product_id: base?.stripe_product_id ?? null,
    stripe_price_id: base?.stripe_price_id ?? null,
    audience_gender: audienceGender || null,
    age_range_text: ageRangeText,
    schedule,
    schedule_timezone: base?.schedule_timezone ?? null,
    schedule_notes: null,
    track_selection_mode: trackSelectionMode,
    track_selection_count: Math.max(1, trackSelectionCount),
    tags: base?.tags ?? null,
    created_at: base?.created_at ?? "",
    updated_at: base?.updated_at ?? "",
  };
}

function serializeProgramEditorState(state: {
  title: string;
  description: string;
  thumbnailUrl: string;
  allAges: boolean;
  ageStart: string;
  ageEnd: string;
  audienceGender: string;
  isPaid: boolean;
  price: string;
  learningVisible: boolean;
  learningTitle: string;
  learningIntro: string;
  outcomeRows: Array<{ text: string }>;
  faqRows: Array<{ question: string; answer: string }>;
  mediaRows: Array<{ url: string; title: string; mediaType: string }>;
  trackRows: Array<{ name: string; sessions: ProgramScheduleRow[] }>;
  trackSelectionMode: TrackSelectionMode;
  trackSelectionCount: number;
  selectedDirectorId?: string;
  instructorDisplayName: string;
  instructorCredentials: string;
  instructorContactPhone: string;
}) {
  return JSON.stringify({
    title: state.title.trim(),
    description: state.description.trim(),
    thumbnailUrl: state.thumbnailUrl.trim(),
    allAges: state.allAges,
    ageStart: state.ageStart.trim(),
    ageEnd: state.ageEnd.trim(),
    audienceGender: state.audienceGender,
    isPaid: state.isPaid,
    price: state.price.trim(),
    learningVisible: state.learningVisible,
    learningTitle: state.learningTitle.trim(),
    learningIntro: state.learningIntro.trim(),
    outcomes: state.outcomeRows.map((row) => row.text.trim()),
    faqs: state.faqRows.map((row) => ({ question: row.question.trim(), answer: row.answer.trim() })),
    media: state.mediaRows.map((row) => ({ url: row.url.trim(), title: row.title.trim(), mediaType: row.mediaType })),
    tracks: state.trackRows.map((track) => ({
      name: track.name.trim(),
      sessions: track.sessions.map((session) => ({ day: session.day, start: session.start, end: session.end })),
    })),
    trackSelectionMode: state.trackSelectionMode,
    trackSelectionCount: state.trackSelectionCount,
    selectedDirectorId: state.selectedDirectorId ?? "",
    instructorDisplayName: state.instructorDisplayName.trim(),
    instructorCredentials: state.instructorCredentials.trim(),
    instructorContactPhone: state.instructorContactPhone.trim(),
  });
}

function ProgramEditorPreview({
  program,
  learningTitle,
  learningIntro,
  outcomes,
  faqRows,
  mediaRows,
  trackRows,
  instructorDisplayName,
  instructorCredentials,
  instructorContactPhone,
  onBack,
}: {
  program: Program;
  learningTitle: string;
  learningIntro: string;
  outcomes: string[];
  faqRows: ProgramEditorFaqRow[];
  mediaRows: Array<{ id: string; url: string; title: string; mediaType: string; previewUrl?: string }>;
  trackRows: Array<{ id: string; name: string; sessions: ProgramScheduleRow[] }>;
  instructorDisplayName: string;
  instructorCredentials: string;
  instructorContactPhone: string;
  onBack: () => void;
}) {
  const age = formatAgeRange(program.age_range_text);
  const gender = formatGender(program.audience_gender);
  const price = formatPrice(program.price_monthly_cents);
  const previewTracks = trackRows.map((track, index): ProgramTrack => ({
    id: track.id,
    program_id: program.id,
    name: track.name.trim() || `Track ${index + 1}`,
    description: null,
    schedule: track.sessions as unknown as Json,
    sort_order: index + 1,
    is_active: true,
    created_at: "",
    updated_at: "",
  }));
  const visibleMediaRows = mediaRows.filter((row) => row.previewUrl || row.url);

  return (
    <div className="fixed inset-0 z-[9000] overflow-y-auto bg-white">
      <button
        type="button"
        onClick={onBack}
        className="fixed left-[max(16px,calc(50%-244px))] top-3 z-[9010] inline-flex min-h-10 items-center rounded-full bg-[#26323A] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(38,50,58,0.18)]"
      >
        Back to Editor
      </button>

      <div className="mx-auto min-h-full max-w-[520px] space-y-5 bg-white p-4 pb-32 pt-16">
      <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
        <ProgramHero program={program} />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#17624F]">
            <span>{age}</span>
            <span aria-hidden>•</span>
            <span>{gender}</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-8 text-[#26323A]">{program.title}</h1>
            <p className="mt-2 text-sm leading-7 text-[#52616A]">{program.description || mockProgramDescription(program.title)}</p>
          </div>
        </div>
      </section>

      <aside className="rounded-2xl border border-[#C8DCE2] bg-white p-4 shadow-[0_14px_34px_rgba(38,50,58,0.10)]">
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-semibold text-[#26323A]">{price}</p>
          {program.is_paid ? <span className="text-xs text-[#6B747B]">monthly</span> : null}
        </div>
        {previewTracks.length ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-end justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Choose schedule</p>
              <p className="text-right text-[11px] font-medium text-[#7B858C]">{trackSelectionRuleText(program, previewTracks.length)}</p>
            </div>
            {previewTracks.map((track) => {
              const schedule = scheduleSummary(track.schedule, null);
              return (
                <div key={track.id} className="rounded-[14px] border border-[#D6DCE0] bg-[#F8FBFC] p-3 text-left">
                  <span className="block text-sm font-semibold text-[#26323A]">{track.name}</span>
                  <span className="mt-1 block text-xs font-medium text-[#17624F]">{schedule.full}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        <button type="button" disabled className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#248B72] px-4 text-sm font-semibold text-white opacity-70">
          Request Enrollment
        </button>
        <dl className="mt-5 divide-y divide-[#E6ECEF] text-sm">
          <SidebarFact label="Age" value={age} />
          <SidebarFact label="Audience" value={gender} />
          <SidebarFact label="Schedule" value={previewTracks[0] ? scheduleSummary(previewTracks[0].schedule, null).full : scheduleSummary(program.schedule, null).full} />
          <SidebarFact label="Teacher" value={instructorDisplayName.trim() || "Teacher to be announced"} />
          <SidebarFact label="Status" value="Open" />
        </dl>
      </aside>

      {(learningIntro.trim() || outcomes.length) && learningTitle.trim() ? (
        <DetailSection title={learningTitle.trim()}>
          {learningIntro.trim() ? <p className="text-sm leading-7 text-[#52616A]">{learningIntro}</p> : null}
          {outcomes.length ? (
            <div className={cn("grid gap-3 sm:grid-cols-2", learningIntro.trim() ? "mt-5" : "")}>
              {outcomes.map((item) => (
                <div key={item} className="flex gap-3 text-sm text-[#26323A]">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3F5EE] text-xs font-semibold text-[#228763]">✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      {visibleMediaRows.length ? (
        <DetailSection title="Program Media">
          <div className="space-y-3">
            {visibleMediaRows.map((row) => (
              <div key={row.id} className="overflow-hidden rounded-[16px] border border-[#E6ECEF]">
                <div className="relative h-40 bg-[#E7EEF2]">
                  <Image src={row.previewUrl || row.url} alt="" fill className="object-cover" sizes="360px" />
                </div>
                {row.title.trim() ? <p className="p-3 text-sm font-semibold text-[#26323A]">{row.title}</p> : null}
              </div>
            ))}
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="Instructor">
        <h2 className="text-base font-semibold text-[#26323A]">{instructorDisplayName.trim() || "Teacher to be announced"}</h2>
        {instructorCredentials.trim() ? <p className="mt-3 text-sm leading-7 text-[#52616A]">{instructorCredentials}</p> : null}
        {instructorContactPhone.trim() ? <p className="mt-3 text-sm font-medium text-[#17624F]">{instructorContactPhone}</p> : null}
      </DetailSection>

      {faqRows.length ? (
        <ProgramFaqSection
          faqs={faqRows.map((row, index) => ({
            id: row.id || `preview-faq-${index}`,
            question: row.question.trim() || `Question ${index + 1}`,
            answer: row.answer.trim() || "Add an answer for this FAQ.",
          }))}
        />
      ) : null}
      </div>
    </div>
  );
}

function EditBox({
  label,
  value,
  onChange,
  required = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B747B]">
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 w-full resize-y rounded-[8px] border border-[#B9C3C8] bg-white px-3 py-2 text-sm leading-6 text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm font-medium text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
      )}
    </label>
  );
}

type ProgramEditorFieldsProps = {
  learningVisible: boolean;
  setLearningVisible: (value: boolean) => void;
  learningTitle: string;
  setLearningTitle: (value: string) => void;
  learningIntro: string;
  setLearningIntro: (value: string) => void;
  outcomeRows: Array<{ id: string; text: string }>;
  setOutcomeRows: Dispatch<SetStateAction<Array<{ id: string; text: string }>>>;
  faqRows: ProgramEditorFaqRow[];
  setFaqRows: Dispatch<SetStateAction<ProgramEditorFaqRow[]>>;
  mediaRows: ProgramEditorMediaRow[];
  setMediaRows: Dispatch<SetStateAction<ProgramEditorMediaRow[]>>;
  onMediaFile: (rowId: string, file: File | null) => void;
  addMedia: () => void;
  trackRows: Array<{ id: string; name: string; sessions: ProgramScheduleRow[] }>;
  setTrackRows: Dispatch<SetStateAction<Array<{ id: string; name: string; sessions: ProgramScheduleRow[] }>>>;
  addTrack: () => void;
  trackSelectionMode: TrackSelectionMode;
  setTrackSelectionMode: (value: TrackSelectionMode) => void;
  trackSelectionCount: number;
  setTrackSelectionCount: (value: number) => void;
  allAges: boolean;
  setAllAges: (value: boolean) => void;
  ageStart: string;
  setAgeStart: (value: string) => void;
  ageEnd: string;
  setAgeEnd: (value: string) => void;
  audienceGender: string;
  setAudienceGender: (value: string) => void;
  isPaid: boolean;
  setIsPaid: (value: boolean) => void;
  price: string;
  setPrice: (value: string) => void;
  instructorDisplayName: string;
  setInstructorDisplayName: (value: string) => void;
  instructorCredentials: string;
  setInstructorCredentials: (value: string) => void;
  instructorContactPhone: string;
  setInstructorContactPhone: (value: string) => void;
};

function ProgramFaqEditor({ faqRows, onChange }: { faqRows: ProgramEditorFaqRow[]; onChange: Dispatch<SetStateAction<ProgramEditorFaqRow[]>> }) {
  return (
    <DetailSection title="FAQs">
      <div className="space-y-3">
       
        {faqRows.map((row, index) => (
          <div key={row.id} className="space-y-2 border-t border-[#E6ECEF] pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7B858C]">Question {index + 1}</p>
              <button
                type="button"
                onClick={() => onChange((current) => current.filter((item) => item.id !== row.id))}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#C83F31] hover:bg-[#FDEDEA]"
                aria-label="Remove FAQ"
              >
                <TrashIcon />
              </button>
            </div>
            <input
              value={row.question}
              onChange={(event) => onChange((current) => current.map((item) => item.id === row.id ? { ...item, question: event.target.value } : item))}
              className="h-11 w-full rounded-[8px] border border-[#B9C3C8] px-3 text-sm outline-none focus:border-[#2F8FB3]"
              placeholder="Question"
            />
            <textarea
              value={row.answer}
              onChange={(event) => onChange((current) => current.map((item) => item.id === row.id ? { ...item, answer: event.target.value } : item))}
              className="min-h-24 w-full resize-y rounded-[8px] border border-[#B9C3C8] px-3 py-2 text-sm leading-6 outline-none focus:border-[#2F8FB3]"
              placeholder="Answer"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange((current) => [...current, { id: crypto.randomUUID(), question: "New question", answer: "Add the answer families should see." }])}
          className="min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]"
        >
          Add FAQ
        </button>
      </div>
    </DetailSection>
  );
}

function ProgramEditorFields({
  learningVisible,
  setLearningVisible,
  learningTitle,
  setLearningTitle,
  learningIntro,
  setLearningIntro,
  outcomeRows,
  setOutcomeRows,
  faqRows,
  setFaqRows,
  mediaRows,
  setMediaRows,
  onMediaFile,
  addMedia,
  trackRows,
  setTrackRows,
  addTrack,
  trackSelectionMode,
  setTrackSelectionMode,
  trackSelectionCount,
  setTrackSelectionCount,
  allAges,
  setAllAges,
  ageStart,
  setAgeStart,
  ageEnd,
  setAgeEnd,
  audienceGender,
  setAudienceGender,
  isPaid,
  setIsPaid,
  price,
  setPrice,
  instructorDisplayName,
  setInstructorDisplayName,
  instructorCredentials,
  setInstructorCredentials,
  instructorContactPhone,
  setInstructorContactPhone,
}: ProgramEditorFieldsProps) {
  function addLearningSection() {
    setLearningVisible(true);
    setLearningTitle("What You Will Learn");
    setLearningIntro("");
    setOutcomeRows([{ id: crypto.randomUUID(), text: "New checklist point" }]);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="space-y-5">
        {learningVisible ? (
          <DetailSection title="Learning Section">
            <div className="space-y-4">
              <EditBox label="Section title" required value={learningTitle} onChange={setLearningTitle} />
              <EditBox label="Section description" value={learningIntro} onChange={setLearningIntro} multiline />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[#26323A]">Checklist</p>
                {outcomeRows.map((row, index) => (
                  <div key={row.id} className="flex items-start gap-2 border-t border-[#E6ECEF] pt-2 first:border-t-0 first:pt-0">
                    <textarea
                      value={row.text}
                      onChange={(event) => setOutcomeRows((current) => current.map((item) => item.id === row.id ? { ...item, text: event.target.value } : item))}
                      className="min-h-16 min-w-0 flex-1 resize-y rounded-[8px] border border-[#B9C3C8] px-3 py-2 text-sm leading-6 outline-none focus:border-[#2F8FB3]"
                      aria-label={`Checklist point ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => setOutcomeRows((current) => current.filter((item) => item.id !== row.id))}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-[#C83F31] hover:bg-[#FDEDEA]"
                      aria-label="Delete checklist point"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setOutcomeRows((current) => [...current, { id: crypto.randomUUID(), text: "New checklist point" }])} className="min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
                  Add point
                </button>
              </div>
              <button type="button" onClick={() => window.confirm("Delete the learning section?") && setLearningVisible(false)} className="min-h-10 rounded-[8px] border border-[#C83F31] px-4 text-sm font-semibold text-[#C83F31]">
                Delete learning section
              </button>
            </div>
          </DetailSection>
        ) : (
          <button type="button" onClick={addLearningSection} className="min-h-28 w-full rounded-[22px] border border-dashed border-[#9EB4BD] bg-white text-sm font-semibold text-[#2F6077]">
            Add checklist section
          </button>
        )}

        <ProgramFaqEditor faqRows={faqRows} onChange={setFaqRows} />

        <DetailSection title="Program Media">
          <div className="divide-y divide-[#E6ECEF]">
            {mediaRows.map((row) => {
              const previewUrl = row.previewUrl || row.url;
              return (
                <div key={row.id} className="grid gap-2 py-3 first:pt-0">
                  {previewUrl ? (
                    <div className="relative h-32 overflow-hidden rounded-[14px] bg-[#E7EEF2]">
                      <Image src={previewUrl} alt="" fill className="object-cover" sizes="320px" />
                    </div>
                  ) : null}
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[8px] border border-[#D6DCE0] bg-white px-3 text-sm font-semibold text-[#26323A]">
                    {previewUrl ? "Replace photo" : "Upload photo"}
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => onMediaFile(row.id, event.target.files?.[0] ?? null)} />
                  </label>
                  <input value={row.title} onChange={(event) => setMediaRows((current) => current.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} placeholder="Optional title" className="h-10 rounded-[8px] border border-[#B9C3C8] px-3 text-sm" />
                  <button type="button" onClick={() => setMediaRows((current) => current.filter((item) => item.id !== row.id))} className="justify-self-start text-sm font-semibold text-[#C83F31]">Remove</button>
                </div>
              );
            })}
            <button type="button" onClick={addMedia} className="min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
              Add media
            </button>
          </div>
        </DetailSection>

        <DetailSection title="Schedule Tracks">
          <div className="divide-y divide-[#E6ECEF]">
            <TrackSelectionRuleFields
              trackCount={trackRows.length}
              mode={trackSelectionMode}
              count={trackSelectionCount}
              onModeChange={setTrackSelectionMode}
              onCountChange={setTrackSelectionCount}
            />
            {trackRows.map((track) => (
              <div key={track.id} className="space-y-3 py-4 first:pt-0">
                <div className="grid grid-cols-[minmax(0,1fr)_36px] items-end gap-2">
                  <EditBox label="Track name" required value={track.name} onChange={(value) => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, name: value } : item))} />
                  {trackRows.length > 1 ? (
                    <button type="button" onClick={() => setTrackRows((current) => current.filter((item) => item.id !== track.id))} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#C83F31] hover:bg-[#FDEDEA]" aria-label="Remove track">
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Times</p>
                  {track.sessions.map((session, sessionIndex) => (
                    <div key={`${track.id}-${sessionIndex}`} className="grid grid-cols-[90px_8px_84px_16px_84px_28px] items-center gap-1">
                      <select
                        value={session.day}
                        onChange={(event) =>
                          setTrackRows((current) =>
                            current.map((item) =>
                              item.id === track.id
                                ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, day: event.target.value as (typeof scheduleDayOptions)[number] } : row) }
                                : item,
                            ),
                          )
                        }
                        className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                      >
                        {scheduleDayOptions.map((day) => <option key={day} value={day}>{day}</option>)}
                      </select>
                      <span className="text-sm font-semibold text-[#6B747B]">-</span>
                      <select
                        value={session.start}
                        onChange={(event) =>
                          setTrackRows((current) =>
                            current.map((item) =>
                              item.id === track.id
                                ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, start: event.target.value } : row) }
                                : item,
                            ),
                          )
                        }
                        className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                      >
                        {scheduleTimeOptions.map((time) => <option key={time} value={time}>{formatClockLabel(time)}</option>)}
                      </select>
                      <span className="text-xs font-semibold text-[#6B747B]">to</span>
                      <select
                        value={session.end}
                        onChange={(event) =>
                          setTrackRows((current) =>
                            current.map((item) =>
                              item.id === track.id
                                ? { ...item, sessions: item.sessions.map((row, index) => index === sessionIndex ? { ...row, end: event.target.value } : row) }
                                : item,
                            ),
                          )
                        }
                        className="h-9 rounded-[7px] border border-[#B9C3C8] px-1 text-xs"
                      >
                        {scheduleTimeOptions.map((time) => <option key={time} value={time}>{formatClockLabel(time)}</option>)}
                      </select>
                      {track.sessions.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, sessions: item.sessions.filter((_row, index) => index !== sessionIndex) } : item))}
                          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[#C83F31] hover:bg-[#FDEDEA]"
                          aria-label="Remove time"
                        >
                          <TrashIcon />
                        </button>
                      ) : <span aria-hidden />}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTrackRows((current) => current.map((item) => item.id === track.id ? { ...item, sessions: [...item.sessions, { day: "Monday", start: "18:00", end: "20:00" }] } : item))}
                    className="min-h-9 rounded-[8px] border border-[#D6DCE0] px-3 text-sm font-semibold text-[#26323A]"
                  >
                    Add time
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addTrack} className="mt-3 min-h-10 rounded-[8px] border border-[#D6DCE0] px-4 text-sm font-semibold text-[#26323A]">
              Add track
            </button>
          </div>
        </DetailSection>
      </div>

      <div className="space-y-4">
        <DetailSection title="Target Audience">
          <label className="flex items-center gap-2 text-sm font-medium text-[#26323A]">
            <input type="checkbox" checked={allAges} onChange={(event) => setAllAges(event.target.checked)} />
            All ages
          </label>
          {!allAges ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <EditBox label="From age" value={ageStart} onChange={setAgeStart} />
              <EditBox label="To age" value={ageEnd} onChange={setAgeEnd} />
            </div>
          ) : null}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B747B]">Gender</span>
            <select value={audienceGender} onChange={(event) => setAudienceGender(event.target.value)} className="h-11 w-full rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]">
              <option value="all">All</option>
              <option value="brothers">Brothers only</option>
              <option value="sisters">Sisters only</option>
            </select>
          </label>
        </DetailSection>

        <DetailSection title="Price">
          <label className="flex items-center gap-2 text-sm font-medium text-[#26323A]">
            <input type="checkbox" checked={isPaid} onChange={(event) => setIsPaid(event.target.checked)} />
            Paid monthly program
          </label>
          {isPaid ? <div className="mt-3"><EditBox label="Monthly price" value={price} onChange={setPrice} /></div> : null}
        </DetailSection>

        <DetailSection title="Instructor Display">
          <div className="space-y-3">
            <EditBox label="Display name" value={instructorDisplayName} onChange={setInstructorDisplayName} />
            <EditBox label="Credentials" value={instructorCredentials} onChange={setInstructorCredentials} multiline />
            <EditBox label="Contact phone" value={instructorContactPhone} onChange={setInstructorContactPhone} />
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

function TrackSelectionRuleFields({
  trackCount,
  mode,
  count,
  onModeChange,
  onCountChange,
}: {
  trackCount: number;
  mode: TrackSelectionMode;
  count: number;
  onModeChange: (value: TrackSelectionMode) => void;
  onCountChange: (value: number) => void;
}) {
  const clampedCount = Math.min(Math.max(1, count), Math.max(1, trackCount));
  return (
    <div className="space-y-2 pb-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Student track choice</p>
      <div className="grid grid-cols-[minmax(0,1fr)_86px] gap-2">
        <select
          value={mode}
          onChange={(event) => onModeChange(normalizeTrackSelectionMode(event.target.value))}
          className="h-10 rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm font-medium text-[#26323A] outline-none focus:border-[#2F8FB3]"
        >
          <option value="exact">Exactly</option>
          <option value="minimum">At least</option>
          <option value="maximum">Up to</option>
        </select>
        <input
          type="number"
          min={1}
          max={Math.max(1, trackCount)}
          value={clampedCount}
          onChange={(event) => onCountChange(Math.max(1, Math.round(Number(event.target.value || "1"))))}
          className="h-10 rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm font-medium text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
      </div>
      <p className="text-xs leading-5 text-[#7B858C]">
        Students will be asked to choose {mode === "exact" ? "exactly" : mode === "minimum" ? "at least" : "up to"} {clampedCount} of the schedule options below.
      </p>
    </div>
  );
}

function normalizeTrackSelectionMode(value: string | null | undefined): TrackSelectionMode {
  return value === "minimum" || value === "maximum" ? value : "exact";
}

function parseAgeRangeForEdit(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "all" || normalized === "all ages") {
    return { allAges: true, start: "", end: "" };
  }

  const numbers = normalized.match(/\d+/g) ?? [];
  return {
    allAges: false,
    start: numbers[0] ?? "",
    end: numbers[1] ?? numbers[0] ?? "",
  };
}

function formatAgeRangeForSave(start: string, end: string) {
  const cleanStart = start.trim();
  const cleanEnd = end.trim();
  if (cleanStart && cleanEnd) {
    return `${cleanStart}-${cleanEnd}`;
  }
  return cleanStart || cleanEnd || null;
}

function normalizeAudienceGender(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("brother") || normalized === "male" || normalized === "boys") {
    return "brothers";
  }
  if (normalized.includes("sister") || normalized === "female" || normalized === "girls") {
    return "sisters";
  }
  return "all";
}

export function AdminTeacherRequestsData({ slug }: { slug: string }) {
  const [requests, setRequests] = useState<Array<MosqueMembership & { profile?: Profile | null; mosque?: Mosque | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRequests() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: mosque } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();
    if (!mosque) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const { data: membershipRows, error: requestError } = await supabase
      .from("mosque_memberships")
      .select("*")
      .eq("mosque_id", mosque.id)
      .eq("role", "teacher")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (requestError) {
      setError(requestError.message);
      setLoading(false);
      return;
    }

    const profileIds = (membershipRows ?? []).map((request) => request.profile_id);
    const { data: profiles } = profileIds.length ? await supabase.from("profiles").select("*").in("id", profileIds) : { data: [] as Profile[] };
    setRequests(
      (membershipRows ?? []).map((request) => ({
        ...request,
        mosque,
        profile: (profiles ?? []).find((profile) => profile.id === request.profile_id) ?? null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRequests();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function setTeacherCreationPermission(requestId: string, canCreatePrograms: boolean) {
    setBusyId(requestId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: reviewError } = await supabase
      .from("mosque_memberships")
      .update({ can_create_programs: canCreatePrograms })
      .eq("id", requestId);
    setBusyId(null);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    await loadRequests();
  }

  if (loading) {
    return <DirectorySkeleton />;
  }

  return (
    <section className="space-y-3 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Teacher permissions</p>
        <h2 className="mt-1 text-xl font-semibold text-[#26323A]">Class creation access</h2>
      </div>
      {error ? <div className="border border-[#F4C7C1] bg-[#FDEDEA] px-4 py-3 text-sm text-[#A4352A]">{error}</div> : null}
      {requests.length === 0 ? (
        <MiniEmpty text="No active teachers found." />
      ) : (
        <div className="divide-y divide-[#E1E6E9] bg-white">
          {requests.map((request) => (
            <div key={request.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-semibold text-[#26323A]">{request.profile?.full_name || request.profile?.email || "Unnamed teacher"}</p>
                <p className="mt-1 text-sm text-[#6B747B]">{[request.profile?.email, request.profile?.phone_number].filter(Boolean).join(" - ") || "No contact details"}</p>
              </div>
              <div className="flex items-center justify-between gap-3 md:justify-end">
                <span className={cn("text-sm font-semibold", request.can_create_programs ? "text-[#17624F]" : "text-[#7B858C]")}>
                  {request.can_create_programs ? "Can create classes" : "Cannot create classes"}
                </span>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => void setTeacherCreationPermission(request.id, !request.can_create_programs)}
                  className={cn(
                    "min-h-10 rounded-full px-4 text-sm font-semibold disabled:opacity-60",
                    request.can_create_programs ? "border border-[#C83F31] bg-white text-[#C83F31]" : "bg-[#17624F] text-white",
                  )}
                >
                  {request.can_create_programs ? "Revoke" : "Allow"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type AdminMemberEnrollmentContext = {
  enrollment: Enrollment;
  program: Program | null;
  tracks: ProgramTrack[];
};
type AdminMemberTeacherClassContext = {
  assignment: ProgramTeacher;
  program: Program | null;
};
type AdminMember = MosqueMembership & {
  profile?: Profile | null;
  enrollmentContexts?: AdminMemberEnrollmentContext[];
  teacherClassContexts?: AdminMemberTeacherClassContext[];
  parentProfile?: Profile | null;
  childProfiles?: Profile[];
  synthetic?: boolean;
};

export function AdminMembersData({ slug }: { slug: string }) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [activeType, setActiveType] = useState<"student" | "parent" | "teacher" | "admin">("student");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<
    | { type: "class_creation"; member: AdminMember; enabled: boolean }
    | { type: "finance"; member: AdminMember; context: AdminMemberTeacherClassContext; enabled: boolean }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMembers() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    if (!mosque) {
      setMembers([]);
      setLoading(false);
      return;
    }

    const { data: membershipRows, error: membershipError } = await supabase
      .from("mosque_memberships")
      .select("*")
      .eq("mosque_id", mosque.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const { data: programRows } = await supabase.from("programs").select("*").eq("mosque_id", mosque.id).order("title", { ascending: true });
    const programIds = (programRows ?? []).map((program) => program.id);
    const { data: teacherAssignmentRows } = programIds.length
      ? await supabase.from("program_teachers").select("*").in("program_id", programIds).not("teacher_profile_id", "is", null).order("created_at", { ascending: true })
      : { data: [] as ProgramTeacher[] };
    const { data: enrollmentRows } = programIds.length ? await supabase.from("enrollments").select("*").in("program_id", programIds) : { data: [] as Enrollment[] };
    const enrollmentIds = (enrollmentRows ?? []).map((enrollment) => enrollment.id);
    const { data: enrollmentTrackRows } = enrollmentIds.length
      ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
      : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };
    const { data: trackRows } = programIds.length
      ? await supabase.from("program_tracks").select("*").in("program_id", programIds).eq("is_active", true).order("sort_order", { ascending: true })
      : { data: [] as ProgramTrack[] };
    const { data: linkRows } = await supabase.from("parent_child_links").select("*").eq("mosque_id", mosque.id);

    const profileIds = Array.from(
      new Set([
        ...(membershipRows ?? []).map((membership) => membership.profile_id),
        ...(teacherAssignmentRows ?? []).map((assignment) => assignment.teacher_profile_id).filter(Boolean) as string[],
        ...(enrollmentRows ?? []).map((enrollment) => enrollment.student_profile_id),
        ...(linkRows ?? []).flatMap((link) => [link.parent_profile_id, link.child_profile_id]),
      ]),
    );
    const { data: profiles } = profileIds.length ? await supabase.from("profiles").select("*").in("id", profileIds) : { data: [] as Profile[] };
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const programById = new Map((programRows ?? []).map((program) => [program.id, program]));
    const trackById = new Map((trackRows ?? []).map((track) => [track.id, track]));
    const trackIdsByEnrollmentId = new Map<string, string[]>();
    for (const row of enrollmentTrackRows ?? []) {
      trackIdsByEnrollmentId.set(row.enrollment_id, [...(trackIdsByEnrollmentId.get(row.enrollment_id) ?? []), row.program_track_id]);
    }
    const enrollmentContextsByStudentId = new Map<string, AdminMemberEnrollmentContext[]>();
    const teacherContextsByProfileId = new Map<string, AdminMemberTeacherClassContext[]>();
    for (const assignment of teacherAssignmentRows ?? []) {
      if (!assignment.teacher_profile_id) {
        continue;
      }
      teacherContextsByProfileId.set(assignment.teacher_profile_id, [
        ...(teacherContextsByProfileId.get(assignment.teacher_profile_id) ?? []),
        {
          assignment,
          program: programById.get(assignment.program_id) ?? null,
        },
      ]);
    }
    for (const enrollment of enrollmentRows ?? []) {
      const selectedTrackIds = trackIdsByEnrollmentId.get(enrollment.id) ?? (enrollment.program_track_id ? [enrollment.program_track_id] : []);
      const context = {
        enrollment,
        program: programById.get(enrollment.program_id) ?? null,
        tracks: selectedTrackIds.map((trackId) => trackById.get(trackId)).filter((track): track is ProgramTrack => Boolean(track)),
      };
      enrollmentContextsByStudentId.set(enrollment.student_profile_id, [...(enrollmentContextsByStudentId.get(enrollment.student_profile_id) ?? []), context]);
    }
    const parentByChildId = new Map<string, Profile>();
    const childrenByParentId = new Map<string, Profile[]>();
    for (const link of linkRows ?? []) {
      const parent = profileById.get(link.parent_profile_id);
      const child = profileById.get(link.child_profile_id);
      if (parent && !parentByChildId.has(link.child_profile_id)) {
        parentByChildId.set(link.child_profile_id, parent);
      }
      if (child) {
        childrenByParentId.set(link.parent_profile_id, [...(childrenByParentId.get(link.parent_profile_id) ?? []), child]);
      }
    }

    const membershipMembers = (membershipRows ?? [])
        .map((membership) => ({
          ...membership,
          profile: profileById.get(membership.profile_id) ?? null,
          enrollmentContexts: enrollmentContextsByStudentId.get(membership.profile_id) ?? [],
          teacherClassContexts: teacherContextsByProfileId.get(membership.profile_id) ?? [],
          parentProfile: parentByChildId.get(membership.profile_id) ?? null,
          childProfiles: childrenByParentId.get(membership.profile_id) ?? [],
        }))
        .filter((membership) => membership.profile?.account_type === membership.role || membership.role === "teacher");
    const existingMembershipProfileIds = new Set(membershipMembers.map((membership) => membership.profile_id));
    const syntheticTeacherMembers: AdminMember[] = Array.from(teacherContextsByProfileId.entries())
      .filter(([profileId]) => !existingMembershipProfileIds.has(profileId))
      .map(([profileId, contexts]) => ({
        id: `teacher-assignment:${profileId}`,
        mosque_id: mosque.id,
        profile_id: profileId,
        role: "teacher",
        status: "active",
        teacher_approval_status: null,
        teacher_approval_reviewed_by: null,
        teacher_approval_reviewed_at: null,
        can_create_programs: false,
        created_at: contexts[0]?.assignment.created_at ?? new Date().toISOString(),
        updated_at: contexts[0]?.assignment.created_at ?? new Date().toISOString(),
        profile: profileById.get(profileId) ?? null,
        enrollmentContexts: [],
        teacherClassContexts: contexts,
        parentProfile: null,
        childProfiles: [],
        synthetic: true,
      }))
      .filter((member) => !member.profile || member.profile.account_type === "teacher");

    setMembers([...membershipMembers, ...syntheticTeacherMembers]);
    setLoading(false);
  }

  useEffect(() => {
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function setTeacherCreationPermission(membershipId: string, canCreatePrograms: boolean) {
    setBusyId(membershipId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("mosque_memberships")
      .update({ can_create_programs: canCreatePrograms })
      .eq("id", membershipId);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadMembers();
  }

  async function setTeacherFinancePermission(assignmentId: string, enabled: boolean) {
    setBusyId(assignmentId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("program_teachers")
      .update({ can_manage_finances: enabled })
      .eq("id", assignmentId)
      .eq("role", "director");
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setToast({ tone: "success", message: enabled ? "Finance access enabled." : "Finance access removed." });
    window.dispatchEvent(new Event("tareeqah:programs-changed"));
    await loadMembers();
  }

  async function confirmPermissionChange() {
    if (!permissionTarget) {
      return;
    }
    const target = permissionTarget;
    setPermissionTarget(null);
    if (target.type === "class_creation") {
      if (target.member.synthetic) {
        setError("This teacher does not have an active teacher membership record yet.");
        return;
      }
      await setTeacherCreationPermission(target.member.id, target.enabled);
      setToast({ tone: "success", message: target.enabled ? "Class creation enabled." : "Class creation removed." });
      return;
    }
    await setTeacherFinancePermission(target.context.assignment.id, target.enabled);
  }

  if (loading) {
    return <DirectorySkeleton />;
  }

  const tabs: Array<{ id: typeof activeType; label: string }> = [
    { id: "student", label: "Students" },
    { id: "parent", label: "Parents" },
    { id: "teacher", label: "Teachers" },
    { id: "admin", label: "Admins" },
  ];
  const visibleMembers =
    activeType === "student"
      ? members.filter((member) => member.role === "student" || (member.role === "parent" && (member.enrollmentContexts?.length ?? 0) > 0))
      : members.filter((member) => member.role === activeType);

  return (
    <section className="space-y-4 bg-[var(--workspace)] p-4">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      {error ? <div className="border border-[#F4C7C1] bg-[#FDEDEA] px-4 py-3 text-sm text-[#A4352A]">{error}</div> : null}
      <div className="grid grid-cols-4 gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveType(tab.id)}
            className={cn(
              "min-h-8 rounded-full px-1.5 text-[11px] font-semibold leading-tight",
              activeType === tab.id ? "bg-[#17624F] text-white" : "bg-[#F1F4F5] text-[#5C6870]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8A949B]">Showing {visibleMembers.length} result{visibleMembers.length === 1 ? "" : "s"}</p>
      {visibleMembers.length === 0 ? (
        <MiniEmpty text={`No active ${activeType} members found.`} />
      ) : (
        <div className="divide-y divide-[#E6EAED] bg-white">
          {visibleMembers.map((member) => (
            <AdminMemberRow
              key={member.id}
              member={member}
              viewType={activeType}
              busyId={busyId}
              onRequestToggleTeacherCreation={() => setPermissionTarget({ type: "class_creation", member, enabled: !member.can_create_programs })}
              onRequestToggleFinance={(context) => setPermissionTarget({ type: "finance", member, context, enabled: !context.assignment.can_manage_finances })}
            />
          ))}
        </div>
      )}
      {permissionTarget ? (
        <AdminTeacherPermissionModal
          target={permissionTarget}
          onCancel={() => setPermissionTarget(null)}
          onConfirm={() => void confirmPermissionChange()}
        />
      ) : null}
    </section>
  );
}

function AdminMemberRow({
  member,
  viewType,
  busyId,
  onRequestToggleTeacherCreation,
  onRequestToggleFinance,
}: {
  member: AdminMember;
  viewType: "student" | "parent" | "teacher" | "admin";
  busyId: string | null;
  onRequestToggleTeacherCreation: () => void;
  onRequestToggleFinance: (context: AdminMemberTeacherClassContext) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = member.profile?.full_name || member.profile?.email || (member.role === "teacher" ? "Assigned teacher" : "Unnamed member");
  const isStudentView = viewType === "student";
  const isChildStudent = isStudentView && Boolean(member.parentProfile);
  const roleLabel = isStudentView ? (isChildStudent ? "Child Student" : "Adult Student") : member.role === "parent" ? "Parent" : member.role === "teacher" ? "Teacher" : "Admin";
  const enrollmentContexts = member.enrollmentContexts ?? [];
  const teacherClassContexts = member.teacherClassContexts ?? [];
  const childProfiles = member.childProfiles ?? [];

  return (
    <article>
      <div className="flex items-center gap-3 py-3">
        <Avatar src={member.profile?.avatar_url ?? null} name={name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{name}</h3>
          <p className="mt-0.5 truncate text-xs font-medium text-[#7B858C]">{roleLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52616A] hover:bg-[#EEF3F5]"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide member details" : "Show member details"}
        >
          <ChevronIcon expanded={expanded} />
        </button>
      </div>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="pb-4 pl-0 pr-2">
            <dl className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)] gap-x-4 gap-y-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3 text-sm">
              <RequestDetail label="Email" value={member.profile?.email} singleLine />
              <RequestDetail label="Phone" value={member.profile?.phone_number} singleLine />
              {member.role === "student" ? (
                <>
                  <RequestDetail label="Age" value={displayAge(member.profile)} />
                  <RequestDetail label="Gender" value={formatStudentDetailGender(member.profile?.gender ?? null)} />
                </>
              ) : null}
              {isStudentView && member.role === "parent" ? (
                <>
                  <RequestDetail label="Date of birth" value={formatMemberDate(member.profile?.date_of_birth ?? null)} singleLine />
                  <RequestDetail label="Gender" value={formatStudentDetailGender(member.profile?.gender ?? null)} />
                </>
              ) : null}
              {viewType === "parent" ? (
                <>
                  <RequestDetail label="Date of birth" value={formatMemberDate(member.profile?.date_of_birth ?? null)} singleLine />
                  <RequestDetail label="Gender" value={formatStudentDetailGender(member.profile?.gender ?? null)} />
                </>
              ) : null}
              {member.role === "teacher" ? (
                <>
                  <RequestDetail label="Class creation" value={member.can_create_programs ? "Allowed" : "Not allowed"} singleLine />
                  <RequestDetail label="Status" value={titleCase(member.status)} singleLine />
                </>
              ) : null}
              {member.role === "admin" ? <RequestDetail label="Status" value={titleCase(member.status)} singleLine /> : null}
            </dl>
            {isStudentView && member.parentProfile ? (
              <div className="mt-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">Parent</p>
                <p className="mt-1 text-sm font-semibold text-[#26323A]">{member.parentProfile.full_name || member.parentProfile.email || "Parent"}</p>
                <p className="mt-1 break-words text-xs font-medium leading-5 text-[#6B747B]">{[member.parentProfile.email, member.parentProfile.phone_number].filter(Boolean).join(" - ") || "No contact details"}</p>
              </div>
            ) : null}
            {isStudentView ? (
              <AdminMemberProgramList title="Classes" emptyText="Not enrolled in any classes." enrollmentContexts={enrollmentContexts} />
            ) : null}
            {viewType === "parent" ? <AdminMemberChildrenList children={childProfiles} /> : null}
            {member.role === "teacher" ? (
              <AdminMemberTeacherClassList
                contexts={teacherClassContexts}
                canCreatePrograms={member.can_create_programs}
                synthetic={Boolean(member.synthetic)}
                busyId={busyId}
                onToggleClassCreation={onRequestToggleTeacherCreation}
                onToggleFinance={onRequestToggleFinance}
              />
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function AdminMemberProgramList({
  title,
  emptyText,
  enrollmentContexts,
}: {
  title: string;
  emptyText: string;
  enrollmentContexts: AdminMemberEnrollmentContext[];
}) {
  return (
    <div className="mt-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">{title}</p>
      {enrollmentContexts.length === 0 ? (
        <p className="mt-1 text-sm font-semibold text-[#26323A]">{emptyText}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {enrollmentContexts.map((context) => {
            const trackText = context.tracks.length ? context.tracks.map((track) => track.name).join(", ") : "No track selected";
            return (
              <div key={context.enrollment.id} className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#26323A]">{context.program?.title ?? "Class"}</p>
                <p className="mt-0.5 truncate text-xs font-medium text-[#6B747B]">{trackText}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminMemberChildrenList({ children }: { children: Profile[] }) {
  return (
    <div className="mt-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">Children</p>
      {children.length === 0 ? (
        <p className="mt-1 text-sm font-semibold text-[#26323A]">No linked children.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <div key={child.id} className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#26323A]">{child.full_name || child.email || "Child"}</p>
              <p className="mt-0.5 truncate text-xs font-medium text-[#6B747B]">
                {[displayAge(child) !== "Not provided" ? `${displayAge(child)} years old` : null, formatStudentDetailGender(child.gender ?? null) !== "Not provided" ? formatStudentDetailGender(child.gender ?? null) : null]
                  .filter(Boolean)
                  .join(" - ") || "No details"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeacherStudentsData({ slug, programId }: { slug: string; programId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromFinances = searchParams.get("from") === "finances";
  const financeStudentId = searchParams.get("studentId");
  const [mosque, setMosque] = useState<Mosque | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [students, setStudents] = useState<Array<{ enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null; trackIds: string[] }>>([]);
  const [tracks, setTracks] = useState<ProgramTrack[]>([]);
  const [selectedRosterTrackIds, setSelectedRosterTrackIds] = useState<string[]>([]);
  const [waitlist, setWaitlist] = useState<RequestWithContext[]>([]);
  const [studentSearch, setStudentSearch] = useState(financeStudentId ?? "");
  const [genderFilter, setGenderFilter] = useState("all");
  const [studentSort, setStudentSort] = useState<"first" | "last" | "age">("first");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [studentView, setStudentView] = useState<"students" | "parents">("students");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<{ studentId: string; studentName: string } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ item: { enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null }; confirmedParent?: boolean } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ request: RequestWithContext; action: "approved" | "rejected" } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [showKickMessage, setShowKickMessage] = useState(false);
  const [kickMessage, setKickMessage] = useState("");

  useEffect(() => {
    if (fromFinances && financeStudentId) {
      setStudentSearch(financeStudentId);
    }
  }, [financeStudentId, fromFinances]);

  function notesHref(studentId: string) {
    const isAdminRoute = typeof window !== "undefined" && window.location.pathname.startsWith(`/m/${slug}/admin/`);
    const basePath = isAdminRoute ? `/m/${slug}/admin/programs` : `/m/${slug}/teacher/classes`;
    return `${basePath}/${programId}/students/${studentId}/notes`;
  }

  async function loadStudents() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    setCurrentUserId(userId);

    const { data: mosqueData, error: mosqueError } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();
    if (mosqueError || !mosqueData) {
      setError(mosqueError?.message ?? "Masjid not found.");
      setLoading(false);
      return;
    }

    const { data: programData, error: programError } = await supabase
      .from("programs")
      .select("*")
      .eq("id", programId)
      .eq("mosque_id", mosqueData.id)
      .maybeSingle();

    if (programError || !programData) {
      setError(programError?.message ?? "Class not found.");
      setLoading(false);
      return;
    }

    const [{ data: enrollmentRows, error: enrollmentError }, { data: waitlistRows, error: waitlistError }, { data: trackRows }] = await Promise.all([
      supabase
        .from("enrollments")
        .select("*")
        .eq("program_id", programData.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("enrollment_requests")
        .select("*")
        .eq("program_id", programData.id)
        .eq("status", "waitlisted")
        .is("student_dismissed_at", null)
        .order("reviewed_at", { ascending: true }),
      supabase.from("program_tracks").select("*").eq("program_id", programData.id).eq("is_active", true).order("sort_order", { ascending: true }),
    ]);

    if (enrollmentError || waitlistError) {
      setError(enrollmentError?.message ?? waitlistError?.message ?? "Could not load students.");
      setLoading(false);
      return;
    }

    const studentIds = Array.from(new Set([...(enrollmentRows ?? []).map((enrollment) => enrollment.student_profile_id), ...(waitlistRows ?? []).map((request) => request.student_profile_id)]));
    const enrollmentIds = (enrollmentRows ?? []).map((enrollment) => enrollment.id);
    const { data: enrollmentTrackRows } = enrollmentIds.length
      ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
      : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };
    const { data: profileRows } = studentIds.length
      ? await supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type").in("id", studentIds)
      : { data: [] as StudentDisplay[] };
    const { data: linkRows } = studentIds.length
      ? await supabase
          .from("parent_child_links")
          .select("child_profile_id, parent_profile_id")
          .eq("mosque_id", mosqueData.id)
          .in("child_profile_id", studentIds)
      : { data: [] as Array<{ child_profile_id: string; parent_profile_id: string }> };
    const parentIds = Array.from(new Set((linkRows ?? []).map((link) => link.parent_profile_id)));
    const { data: parentRows } = parentIds.length
      ? await supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url").in("id", parentIds)
      : { data: [] as ParentDisplay[] };

    setMosque(mosqueData);
    setProgram(programData);
    setTracks(trackRows ?? []);
    setSelectedRosterTrackIds((current) => {
      const availableTrackIds = new Set((trackRows ?? []).map((track) => track.id));
      const next = current.filter((trackId) => availableTrackIds.has(trackId));
      return next.length ? next : (trackRows ?? []).map((track) => track.id);
    });
    setStudents(
      (enrollmentRows ?? []).map((enrollment) => ({
        enrollment,
        trackIds: (enrollmentTrackRows ?? [])
          .filter((row) => row.enrollment_id === enrollment.id)
          .map((row) => row.program_track_id)
          .filter(Boolean)
          .concat(enrollment.program_track_id ? [enrollment.program_track_id] : [])
          .filter((trackId, index, all) => all.indexOf(trackId) === index),
        profile: (profileRows ?? []).find((profile) => profile.id === enrollment.student_profile_id) ?? null,
        parent:
          ((parentRows ?? []).find(
            (parent) => parent.id === (linkRows ?? []).find((link) => link.child_profile_id === enrollment.student_profile_id)?.parent_profile_id,
          ) as ParentDisplay | undefined) ?? null,
      })),
    );
    setWaitlist(
      (waitlistRows ?? []).map((request) => ({
        ...request,
        program: programData,
        student: (profileRows ?? []).find((profile) => profile.id === request.student_profile_id) ?? null,
        parent: request.parent_profile_id ? ((parentRows ?? []).find((parent) => parent.id === request.parent_profile_id) as ParentDisplay | undefined) ?? null : null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadStudents();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, slug]);

  async function kickStudent(studentId: string, customMessage?: string) {
    if (!program || !mosque || !currentUserId) {
      return;
    }

    setBusyStudentId(studentId);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: deleteError } = await supabase
      .from("enrollments")
      .delete()
      .eq("program_id", program.id)
      .eq("student_profile_id", studentId);

    if (deleteError) {
      setError(deleteError.message);
      setBusyStudentId(null);
      return;
    }

    const now = new Date().toISOString();
    const parentId = students.find((student) => student.enrollment.student_profile_id === studentId)?.parent?.id ?? null;
    const reviewNote = customMessage?.trim() || `You were removed from ${program.title}.`;
    const { error: noticeError } = await supabase.from("enrollment_requests").upsert(
      {
        mosque_id: mosque.id,
        program_id: program.id,
        student_profile_id: studentId,
        parent_profile_id: parentId,
        status: "cancelled",
        reviewed_by: currentUserId,
        reviewed_at: now,
        review_note: reviewNote,
        student_dismissed_at: null,
      },
      { onConflict: "program_id,student_profile_id" },
    );

    if (noticeError) {
      setError(noticeError.message);
    }

    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    setBusyStudentId(null);
    setKickTarget(null);
    setShowKickMessage(false);
    setKickMessage("");
    await loadStudents();
  }

  async function reviewWaitlistedRequest(
    request: RequestWithContext,
    status: "approved" | "rejected",
    options: { priceMonthlyCents?: number | null; paymentBypassed?: boolean; note?: string | null } = {},
  ) {
    if (!currentUserId || !program) {
      return;
    }

    if (status === "approved" && program.is_paid && !options.paymentBypassed && (options.priceMonthlyCents ?? 0) < 50) {
      setError("Paid approvals need a monthly price of at least $0.50, or choose bypass payment.");
      return;
    }

    setReviewBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const now = new Date().toISOString();
    const { error: reviewError } = await supabase
      .from("enrollment_requests")
      .update({
        status,
        reviewed_by: currentUserId,
        reviewed_at: now,
        review_note: options.note?.trim() || null,
        decision_note: options.note?.trim() || null,
        approved_price_monthly_cents: status === "approved" ? (options.paymentBypassed ? 0 : options.priceMonthlyCents ?? program.price_monthly_cents ?? null) : null,
        payment_bypassed: status === "approved" ? Boolean(options.paymentBypassed) : false,
        admission_completed_at: status === "approved" && (!program.is_paid || options.paymentBypassed) ? now : null,
        teacher_dismissed_at: null,
      })
      .eq("id", request.id);

    if (reviewError) {
      setReviewBusy(false);
      setError(reviewError.message);
      return;
    }

    if (status === "approved" && (!program.is_paid || options.paymentBypassed)) {
      await supabase.from("enrollments").upsert(
        {
          program_id: request.program_id,
          student_profile_id: request.student_profile_id,
          program_track_id: request.program_track_id,
        },
        { onConflict: "program_id,student_profile_id" },
      );
    }

    queueEnrollmentRequestReviewedEmail(request.id);
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadStudents();
    setReviewBusy(false);
    setReviewTarget(null);
    setToast({ tone: "success", message: status === "approved" ? "Waitlisted application accepted." : "Waitlisted application rejected." });
  }

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    const sorted = students
      .filter((student) => {
        const gender = normalizeGender(student.profile?.gender ?? null);
        const genderMatches = studentView === "parents" || genderFilter === "all" || gender === genderFilter;
        if (!genderMatches) {
          return false;
        }
        const trackMatches =
          tracks.length === 0 ||
          selectedRosterTrackIds.length === tracks.length ||
          (student.trackIds ?? []).some((trackId) => selectedRosterTrackIds.includes(trackId));
        if (!trackMatches) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [
          student.profile?.full_name,
          student.profile?.email,
          student.profile?.phone_number,
          student.parent?.full_name,
          student.parent?.email,
          student.parent?.phone_number,
          student.enrollment.student_profile_id,
          student.enrollment.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        let comparison = 0;
        if (studentSort === "age") {
          comparison = (profileAgeNumber(left.profile) ?? 999) - (profileAgeNumber(right.profile) ?? 999);
        } else if (studentSort === "last") {
          comparison = lastNameOf(left.profile?.full_name ?? "").localeCompare(lastNameOf(right.profile?.full_name ?? ""));
        } else {
          comparison = firstNameOf(left.profile?.full_name ?? "").localeCompare(firstNameOf(right.profile?.full_name ?? ""));
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    return sorted;
  }, [genderFilter, selectedRosterTrackIds, sortDirection, studentSearch, studentSort, studentView, students, tracks]);
  const familyGroups = useMemo(() => {
    const groups = new Map<string, { parent: ParentDisplay | null; children: TeacherStudentItem[] }>();
    for (const student of filteredStudents) {
      if (!student.parent) {
        continue;
      }
      const key = student.parent?.id ?? `student:${student.enrollment.student_profile_id}`;
      const current = groups.get(key) ?? { parent: student.parent ?? null, children: [] };
      current.children.push(student);
      groups.set(key, current);
    }
    return Array.from(groups.values()).sort((left, right) => {
      const leftName = left.parent?.full_name ?? left.children[0]?.profile?.full_name ?? "";
      const rightName = right.parent?.full_name ?? right.children[0]?.profile?.full_name ?? "";
      const comparison =
        studentSort === "last"
          ? lastNameOf(leftName).localeCompare(lastNameOf(rightName))
          : firstNameOf(leftName).localeCompare(firstNameOf(rightName));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredStudents, sortDirection, studentSort]);
  const resultCount = studentView === "parents" ? familyGroups.length : filteredStudents.length;
  const hasVisibleStudents = resultCount > 0;

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error && !program) {
    return <EmptyState title="Could not load students" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This teacher class could not be loaded." />;
  }

  return (
    <div className="bg-white px-5 pb-28 pt-5">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      {fromFinances ? (
        <div className="sticky top-3 z-20 mb-4">
          <button
            type="button"
            onClick={() => router.push(`${typeof window !== "undefined" && window.location.pathname.startsWith(`/m/${slug}/admin/`) ? `/m/${slug}/admin/programs` : `/m/${slug}/teacher/classes`}/${programId}/finances`)}
            className="min-h-10 rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(23,98,79,0.22)]"
          >
            Back to Finances
          </button>
        </div>
      ) : null}
      <div className="space-y-5">
        {error ? <div className="border-l-4 border-[#E25241] bg-[#FDEDEA] p-3 text-sm text-[#A4352A]">{error}</div> : null}

        <section className="space-y-4">
          <TeacherStudentListControls
            search={studentSearch}
            gender={genderFilter}
            sort={studentSort}
            sortDirection={sortDirection}
            view={studentView}
            tracks={tracks}
            selectedTrackIds={selectedRosterTrackIds}
            onSearchChange={setStudentSearch}
            onGenderChange={setGenderFilter}
            onTrackToggle={(trackId) =>
              setSelectedRosterTrackIds((current) => {
                const allTrackIds = tracks.map((track) => track.id);
                if (trackId === "select_all") {
                  return allTrackIds;
                }
                if (trackId === "deselect_all") {
                  return [];
                }
                return current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId];
              })
            }
            onSortChange={setStudentSort}
            onSortDirectionChange={setSortDirection}
            onViewChange={(view) => {
              setStudentView(view);
              if (view === "parents") {
                setGenderFilter("all");
              }
            }}
          />
          <p className="text-xs font-medium text-[#9AA4AA]">
            Showing {resultCount} {resultCount === 1 ? "result" : "results"}
          </p>
          {hasVisibleStudents ? (
            <div className="divide-y divide-[#EEF2F4]">
              {studentView === "parents" ? (
              familyGroups.map((group) => (
                <TeacherFamilyRow
                  key={group.parent?.id ?? group.children[0]?.enrollment.id}
                  group={group}
                  busyStudentId={busyStudentId}
                  onKick={(student) => {
                    setKickTarget({
                      studentId: student.enrollment.student_profile_id,
                      studentName: student.profile?.full_name ?? "this student",
                    });
                    setShowKickMessage(false);
                    setKickMessage("");
                  }}
                  onNote={(student) => {
                    if (student.parent) {
                      setNoteTarget({ item: student });
                      return;
                    }
                    router.push(notesHref(student.enrollment.student_profile_id));
                  }}
                />
              ))
              ) : (
              filteredStudents.map((student) => (
                <TeacherStudentRow
                  key={student.enrollment.id}
                  item={student}
                  busy={busyStudentId === student.enrollment.student_profile_id}
                  onKick={() => {
                    setKickTarget({
                      studentId: student.enrollment.student_profile_id,
                      studentName: student.profile?.full_name ?? "this student",
                    });
                    setShowKickMessage(false);
                    setKickMessage("");
                  }}
                  onNote={() => {
                    if (student.parent) {
                      setNoteTarget({ item: student });
                      return;
                    }
                    router.push(notesHref(student.enrollment.student_profile_id));
                  }}
                />
              ))
              )}
            </div>
          ) : (
            <HomeEmptyState title={students.length ? "No matching students" : "No enrolled students"} text={students.length ? "Adjust the search or filters." : "Accepted students will appear here."} />
          )}
        </section>

        {!fromFinances && waitlist.length ? (
          <section className="space-y-3">
            <HomeSectionTitle title="Waitlist" />
            {waitlist.map((request) => (
              <TeacherRequestCard
                key={request.id}
                request={request}
                onAccept={() => setReviewTarget({ request, action: "approved" })}
                onReject={() => setReviewTarget({ request, action: "rejected" })}
              />
            ))}
          </section>
        ) : null}
      </div>
      {reviewTarget ? (
        <ApplicationDecisionModal
          target={reviewTarget}
          busy={reviewBusy}
          onClose={() => {
            if (!reviewBusy) {
              setReviewTarget(null);
            }
          }}
          onSubmit={(options) => reviewWaitlistedRequest(reviewTarget.request, reviewTarget.action, options)}
        />
      ) : null}
      {kickTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
            <h2 className="text-xl font-semibold">Remove student?</h2>
            <p className="mt-2 text-sm leading-6 text-[#6B747B]">
              {kickTarget.studentName} will be removed from {program.title}. Any active payment subscription should be cancelled immediately, and they will receive a notification in their inbox.
            </p>
            <button
              type="button"
              onClick={() => setShowKickMessage((value) => !value)}
              className="mt-4 text-sm font-semibold text-[#2F8FB3] underline-offset-4 hover:underline"
            >
              {showKickMessage ? "Remove message" : "Add message"}
            </button>
            {showKickMessage ? (
              <textarea
                value={kickMessage}
                onChange={(event) => setKickMessage(event.target.value)}
                placeholder={`Optional message. Default: You were removed from ${program.title}.`}
                className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-[#D6DCE0] bg-[#F8FAFB] px-4 py-3 text-sm leading-6 text-[#26323A] outline-none focus:border-[#2F8FB3]"
              />
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setKickTarget(null);
                  setShowKickMessage(false);
                  setKickMessage("");
                }}
                className="px-2 py-2 text-sm font-semibold text-[#6B747B]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => kickStudent(kickTarget.studentId, kickMessage)}
                disabled={busyStudentId === kickTarget.studentId}
                className="rounded-full bg-[#FCE8E4] px-5 py-2.5 text-sm font-semibold text-[#C83F31] transition-colors hover:bg-[#F9D8D1] disabled:opacity-60"
              >
                {busyStudentId === kickTarget.studentId ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {noteTarget?.item.parent && !noteTarget.confirmedParent ? (
        <ChildNoteRecipientPrompt
          studentName={noteTarget.item.profile?.full_name ?? "this child"}
          parentName={noteTarget.item.parent.full_name ?? "parent"}
          onClose={() => setNoteTarget(null)}
          onGoToParent={() => router.push(notesHref(noteTarget.item.enrollment.student_profile_id))}
        />
      ) : null}
    </div>
  );
}

function AdminMemberTeacherClassList({
  contexts,
  canCreatePrograms,
  synthetic,
  busyId,
  onToggleClassCreation,
  onToggleFinance,
}: {
  contexts: AdminMemberTeacherClassContext[];
  canCreatePrograms: boolean;
  synthetic: boolean;
  busyId: string | null;
  onToggleClassCreation: () => void;
  onToggleFinance: (context: AdminMemberTeacherClassContext) => void;
}) {
  return (
    <div className="mt-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">Involved Classes</p>
      {contexts.length === 0 ? (
        <p className="mt-1 text-sm font-semibold text-[#26323A]">Not assigned to any classes.</p>
      ) : (
        <div className="mt-2 divide-y divide-[#E3E8EC]">
          {contexts.map((context) => {
            const isDirector = context.assignment.role === "director";
            return (
              <div key={context.assignment.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#26323A]">{context.program?.title ?? "Class"}</p>
                  <p className="mt-0.5 truncate text-xs font-medium text-[#6B747B]">{isDirector ? "Director" : "Instructor"}</p>
                </div>
                {isDirector ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <PermissionIconButton
                      label={canCreatePrograms ? "Class creation active" : "Class creation inactive"}
                      active={canCreatePrograms}
                      disabled={synthetic || busyId === context.assignment.id}
                      icon="class"
                      onClick={onToggleClassCreation}
                    />
                    <PermissionIconButton
                      label={context.assignment.can_manage_finances ? "Finance access active" : "Finance access inactive"}
                      active={context.assignment.can_manage_finances}
                      disabled={busyId === context.assignment.id}
                      icon="finance"
                      onClick={() => onToggleFinance(context)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[#7B858C]">
        <span className="inline-flex items-center gap-1"><PermissionClassIcon /> Class creation</span>
        <span className="inline-flex items-center gap-1"><FinanceIcon /> Finances</span>
      </div>
    </div>
  );
}

function PermissionIconButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: "class" | "finance";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border transition disabled:opacity-45",
        active ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#CAD4DA] bg-white text-[#8A949B]",
      )}
      aria-label={label}
      title={label}
    >
      {icon === "class" ? <PermissionClassIcon /> : <FinanceIcon />}
    </button>
  );
}

function AdminTeacherPermissionModal({
  target,
  onCancel,
  onConfirm,
}: {
  target:
    | { type: "class_creation"; member: AdminMember; enabled: boolean }
    | { type: "finance"; member: AdminMember; context: AdminMemberTeacherClassContext; enabled: boolean };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const teacherName = target.member.profile?.full_name || target.member.profile?.email || "this teacher";
  const permission = target.type === "class_creation" ? "class creation" : "finance management";
  const className = target.type === "finance" ? target.context.program?.title ?? "this class" : null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", target.enabled ? "bg-[#E8F7F2] text-[#17624F]" : "bg-[#F3F6F8] text-[#52616A]")}>
          {target.type === "class_creation" ? <PermissionClassIcon /> : <FinanceIcon />}
        </div>
        <h2 className="mt-4 text-xl font-semibold">{target.enabled ? "Enable" : "Disable"} {permission}?</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          {target.enabled ? "Allow" : "Remove"} {permission} for {teacherName}
          {className ? ` on ${className}` : ""}.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-10 px-3 text-sm font-semibold text-[#6B747B]">Cancel</button>
          <button type="button" onClick={onConfirm} className="min-h-10 rounded-[10px] bg-[#17624F] px-4 text-sm font-semibold text-white">Confirm</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type FinanceEnrollmentRow = {
  enrollment: Enrollment;
  student: StudentDisplay | null;
  parent: ParentDisplay | null;
  approver: Profile | null;
  request: EnrollmentRequest | null;
  subscription: ProgramSubscription | null;
};

type FinanceAction = "waive" | "change_price" | "end_subscription" | "student_info" | "payment_history";

export function ProgramFinancesData({ slug, programId, mode = "teacher" }: { slug: string; programId: string; mode?: "teacher" | "admin" }) {
  const router = useRouter();
  const [program, setProgram] = useState<Program | null>(null);
  const [rows, setRows] = useState<FinanceEnrollmentRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<ProgramFinanceAuditEvent[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionTarget, setActionTarget] = useState<{ row: FinanceEnrollmentRow; action: FinanceAction } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFinanceRows();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, slug, mode]);

  async function loadFinanceRows() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const session = await loadCachedSession();
    const userId = session?.user.id ?? null;
    if (!userId) {
      setError("Log in required.");
      setLoading(false);
      return;
    }

    const [{ data: mosque, error: mosqueError }, { data: profile }] = await Promise.all([
      supabase.from("mosques").select("id").eq("slug", slug).maybeSingle(),
      supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
    ]);

    if (mosqueError || !mosque) {
      setError(mosqueError?.message ?? "Masjid not found.");
      setLoading(false);
      return;
    }

    const { data: programRow, error: programError } = await supabase.from("programs").select("*").eq("id", programId).eq("mosque_id", mosque.id).maybeSingle();
    if (programError || !programRow) {
      setError(programError?.message ?? "Class not found.");
      setLoading(false);
      return;
    }

    const [{ data: memberships }, { data: directorAssignment }] = await Promise.all([
      supabase.from("mosque_memberships").select("role, status").eq("mosque_id", mosque.id).eq("profile_id", userId),
      supabase
        .from("program_teachers")
        .select("id, can_manage_finances, role")
        .eq("program_id", programId)
        .eq("teacher_profile_id", userId)
        .eq("role", "director")
        .maybeSingle(),
    ]);
    const isAdmin = profile?.account_type === "admin" && (memberships ?? []).some((membership) => membership.role === "admin" && membership.status === "active");
    const hasDirectorFinanceAccess = Boolean(directorAssignment?.can_manage_finances);
    if (!isAdmin && !hasDirectorFinanceAccess) {
      setProgram(programRow);
      setRows([]);
      setAuditEvents([]);
      setError("Finance access has not been enabled for this class.");
      setLoading(false);
      return;
    }

    const [{ data: enrollmentRows, error: enrollmentError }, { data: requestRows }, { data: subscriptionRows }, { data: auditRows }] = await Promise.all([
      supabase.from("enrollments").select("*").eq("program_id", programId).order("created_at", { ascending: true }),
      supabase.from("enrollment_requests").select("*").eq("program_id", programId).order("requested_at", { ascending: false }),
      supabase.from("program_subscriptions").select("*").eq("program_id", programId).order("updated_at", { ascending: false }),
      supabase.from("program_finance_audit_events").select("*").eq("program_id", programId).order("created_at", { ascending: false }).limit(20),
    ]);

    if (enrollmentError) {
      setError(enrollmentError.message);
      setLoading(false);
      return;
    }

    const studentIds = Array.from(new Set((enrollmentRows ?? []).map((enrollment) => enrollment.student_profile_id)));
    const { data: linkRows } = studentIds.length
      ? await supabase.from("parent_child_links").select("child_profile_id, parent_profile_id").eq("mosque_id", mosque.id).in("child_profile_id", studentIds)
      : { data: [] as Array<{ child_profile_id: string; parent_profile_id: string }> };
    const reviewerIds = Array.from(new Set((requestRows ?? []).map((request) => request.reviewed_by).filter(Boolean) as string[]));
    const parentIds = Array.from(
      new Set([
        ...(linkRows ?? []).map((link) => link.parent_profile_id),
        ...(requestRows ?? []).map((request) => request.parent_profile_id).filter(Boolean) as string[],
        ...(subscriptionRows ?? []).map((subscription) => subscription.parent_profile_id).filter(Boolean) as string[],
      ]),
    );
    const profileIds = Array.from(new Set([...studentIds, ...parentIds, ...reviewerIds]));
    const { data: profileRows } = profileIds.length
      ? await supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type").in("id", profileIds)
      : { data: [] as StudentDisplay[] };

    setProgram(programRow);
    setRows(
      (enrollmentRows ?? []).map((enrollment) => {
        const request = (requestRows ?? []).find((item) => item.student_profile_id === enrollment.student_profile_id) ?? null;
        const subscription = (subscriptionRows ?? []).find((item) => item.student_profile_id === enrollment.student_profile_id) ?? null;
        const parentId =
          request?.parent_profile_id ??
          subscription?.parent_profile_id ??
          (linkRows ?? []).find((link) => link.child_profile_id === enrollment.student_profile_id)?.parent_profile_id ??
          null;
        return {
          enrollment,
          request,
          subscription,
          student: (profileRows ?? []).find((profile) => profile.id === enrollment.student_profile_id) as StudentDisplay | null,
          approver: request?.reviewed_by ? ((profileRows ?? []).find((profile) => profile.id === request.reviewed_by) as Profile | undefined) ?? null : null,
          parent: parentId ? ((profileRows ?? []).find((profile) => profile.id === parentId) as ParentDisplay | undefined) ?? null : null,
        };
      }),
    );
    setAuditEvents(auditRows ?? []);
    setLoading(false);
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = financeStatus(row);
      const payment = financePaymentType(row, program);
      const studentType = financeStudentType(row);
      if (statusFilter !== "all" && status.toLowerCase() !== statusFilter) {
        return false;
      }
      if (paymentFilter !== "all" && payment.toLowerCase() !== paymentFilter) {
        return false;
      }
      if (typeFilter !== "all" && studentType !== typeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [row.student?.full_name, row.parent?.full_name, row.student?.email, row.parent?.email, payment, status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [paymentFilter, program, rows, search, statusFilter, typeFilter]);

  const activeRows = rows.filter((row) => financeStatus(row) === "Active");
  const monthlySumCents = activeRows.reduce((sum, row) => sum + financeMonthlyAmountCents(row, program), 0);

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error && !program) {
    return <EmptyState title="Could not load finances" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This class could not be loaded." />;
  }

  if (error) {
    return <EmptyState title="Finance access unavailable" text={error} />;
  }

  return (
    <section className="space-y-5 bg-white px-4 pb-28 pt-4 text-[#26323A]">
      <div className="rounded-[28px] bg-[#17624F] p-5 text-white shadow-[0_18px_45px_rgba(23,98,79,0.22)]">
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/65">Finance Control</p>
            <h2 className="mt-2 text-2xl font-semibold leading-7">{program.title}</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <FinanceSummaryFigure value={rows.length.toString()} label="Total records" />
            <FinanceSummaryFigure value={activeRows.length.toString()} label="Active students" />
            <FinanceSummaryFigure value={formatPrice(monthlySumCents)} label="Monthly sum" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="flex min-h-11 items-center gap-2 rounded-[14px] border border-[#D6DCE0] bg-[#F8FAFB] px-3 text-[#6B747B]">
          <SearchIcon />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students, parents, status" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#26323A] outline-none placeholder:text-[#9AA4AA]" />
        </label>
        <FinanceSelect label="Status" value={statusFilter} options={["active", "kicked", "withdrawn"]} onChange={setStatusFilter} />
        <FinanceSelect label="Payment" value={paymentFilter} options={["waived", "monthly", "annual"]} onChange={setPaymentFilter} />
        <FinanceSelect label="Type" value={typeFilter} options={["adult", "child"]} labels={{ adult: "Adult student", child: "Child student" }} onChange={setTypeFilter} />
      </div>

      <div className="overflow-hidden rounded-[24px] border border-[#E1E8EC] bg-white shadow-[0_14px_38px_rgba(38,50,58,0.08)]">
        <div className="overflow-x-auto">
          <table className="min-w-[1240px] w-full text-left text-sm">
            <thead className="bg-[#F7FAFB] text-[11px] font-semibold uppercase tracking-wide text-[#7B858C]">
              <tr>
                {["Student", "Parent", "Payment Type", "Price", "Status", "Last Payment", "Times Paid", "Next Billing", "Date Joined", "Approved By", "Actions"].map((column) => (
                  <th key={column} className="px-4 py-3">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F4]">
              {filteredRows.map((row) => (
                <tr key={row.enrollment.id} className="align-middle">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-[#26323A]">{row.student?.full_name || "Student"}</p>
                    <p className="mt-0.5 text-xs text-[#7B858C]">{row.student?.email || "No student email"}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-[#26323A]">{row.parent?.full_name || "---"}</p>
                    <p className="mt-0.5 text-xs text-[#7B858C]">{row.parent?.email || "---"}</p>
                  </td>
                  <td className="px-4 py-4 font-semibold text-[#52616A]">{financePaymentType(row, program)}</td>
                  <td className="px-4 py-4 font-semibold text-[#26323A]">{financePrice(row, program)}</td>
                  <td className="px-4 py-4">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", financeStatus(row).toLowerCase() === "active" ? "bg-[#EAF8EF] text-[#258A43]" : "bg-[#F3F6F8] text-[#52616A]")}>
                      {financeStatus(row)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-[#52616A]">{formatFinanceDate(row.subscription?.current_period_start)}</td>
                  <td className="px-4 py-4 font-semibold text-[#26323A]">{financeTimesPaid(row)}</td>
                  <td className="px-4 py-4 text-[#52616A]">{formatFinanceDate(row.subscription?.current_period_end)}</td>
                  <td className="px-4 py-4 text-[#52616A]">{formatFinanceDate(row.enrollment.created_at)}</td>
                  <td className="px-4 py-4 text-[#52616A]">{row.approver?.full_name ?? row.approver?.email ?? "---"}</td>
                  <td className="px-4 py-4">
                    <FinanceRowActionMenu
                      row={row}
                      onSelect={(action) => {
                        if (action === "student_info") {
                          const basePath = mode === "admin" ? `/m/${slug}/admin/programs` : `/m/${slug}/teacher/classes`;
                          router.push(`${basePath}/${programId}/students?from=finances&studentId=${row.enrollment.student_profile_id}`);
                          return;
                        }
                        setActionTarget({ row, action });
                      }}
                    />
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm font-semibold text-[#7B858C]">No matching finance rows.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#26323A]">Audit Trail</h2>
          <span className="rounded-full bg-[#EEF6F7] px-2.5 py-1 text-xs font-semibold text-[#17624F]">{auditEvents.length || rows.length}</span>
        </div>
        <div className="divide-y divide-[#EEF2F4]">
          {auditEvents.length
            ? auditEvents.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="text-sm font-semibold text-[#26323A]">{event.summary}</p>
                  <p className="mt-0.5 text-xs text-[#7B858C]">{formatFinanceDate(event.created_at)} - {event.event_type.replace(/_/g, " ")}</p>
                </div>
              ))
            : rows.slice(0, 5).map((row) => (
                <div key={row.enrollment.id} className="py-3">
                  <p className="text-sm font-semibold text-[#26323A]">{financeAuditFallbackSummary(row, program)}</p>
                  <p className="mt-0.5 text-xs text-[#7B858C]">{formatFinanceDate(row.enrollment.created_at)} - finance activity</p>
                </div>
              ))}
        </div>
      </section>

      {actionTarget ? <FinanceActionModal row={actionTarget.row} action={actionTarget.action} program={program} onClose={() => setActionTarget(null)} /> : null}
    </section>
  );
}

function FinanceRowActionMenu({ row, onSelect }: { row: FinanceEnrollmentRow; onSelect: (action: FinanceAction) => void }) {
  const [open, setOpen] = useState(false);
  const studentName = row.student?.full_name || "student";

  return (
    <div className="relative inline-flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F5F6] text-[#26323A] transition-colors hover:bg-[#E3ECEF]"
        aria-label={`Open finance actions for ${studentName}`}
      >
        <MoreVerticalIcon />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-[16px] border border-[#E1E8EC] bg-white p-1 text-sm shadow-[0_18px_45px_rgba(38,50,58,0.14)]">
          {[
            { action: "student_info" as const, label: "Student information" },
            { action: "payment_history" as const, label: "View payment history" },
            { action: "waive" as const, label: "Waive tuition" },
            { action: "change_price" as const, label: "Change price" },
            { action: "end_subscription" as const, label: "End subscription" },
          ].map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(item.action);
              }}
              className="flex min-h-10 w-full items-center rounded-[12px] px-3 text-left font-semibold text-[#52616A] transition-colors hover:bg-[#F4F8F9] hover:text-[#26323A]"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FinanceSummaryFigure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-semibold leading-none text-white md:text-4xl">{value}</p>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">{label}</p>
    </div>
  );
}

function FinanceSelect({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-[14px] border border-[#D6DCE0] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#26323A] outline-none">
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{labels[option] ?? titleCase(option)}</option>
        ))}
      </select>
    </label>
  );
}

function FinanceActionModal({ row, action, program, onClose }: { row: FinanceEnrollmentRow; action: FinanceAction; program: Program; onClose: () => void }) {
  const [price, setPrice] = useState(((row.request?.approved_price_monthly_cents ?? program.price_monthly_cents ?? 0) / 100).toFixed(2).replace(/\.00$/, ""));
  const [billingMode, setBillingMode] = useState<"monthly" | "one_time">("monthly");
  const modalTitle = action === "waive" ? "Waive tuition" : action === "change_price" ? "Change price" : action === "end_subscription" ? "End subscription" : "Payment history";
  const modalText =
    action === "waive"
      ? "Pause charges indefinitely or for a fixed number of months while keeping the student enrolled."
      : action === "change_price"
        ? "Changing the price should end the current subscription and send a new checkout link."
        : action === "end_subscription"
          ? "Stop future billing either while keeping the student enrolled or while also removing them from class."
          : "Payment history will show charges, exceptions, links, and subscription lifecycle events.";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">{program.title}</p>
        <h2 className="mt-1 text-xl font-semibold">{modalTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">{row.student?.full_name || "Student"} - {modalText}</p>

        <div className="mt-5">
          {action === "waive" ? (
            <div className="grid grid-cols-3 gap-2">
              {["Indefinite", "1 month", "3 months"].map((label) => (
                <button key={label} type="button" className="min-h-10 rounded-[10px] bg-[#EEF6F7] px-2 text-xs font-semibold text-[#17624F]">{label}</button>
              ))}
            </div>
          ) : null}
          {action === "change_price" ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="h-11 rounded-[10px] border border-[#B9C3C8] px-3 text-sm font-semibold outline-none focus:border-[#2F8FB3]" />
              <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-[#D6DCE0]">
                {(["monthly", "one_time"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setBillingMode(mode)} className={cn("px-3 text-xs font-semibold", billingMode === mode ? "bg-[#17624F] text-white" : "bg-white text-[#52616A]")}>
                    {mode === "monthly" ? "Monthly" : "One-time"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {action === "end_subscription" ? (
            <div className="grid gap-2">
              <button type="button" className="min-h-10 rounded-[10px] bg-[#EEF3F5] px-3 text-sm font-semibold text-[#26323A]">End billing, keep student</button>
              <button type="button" className="min-h-10 rounded-[10px] bg-[#26323A] px-3 text-sm font-semibold text-white">End billing and remove student</button>
            </div>
          ) : null}
          {action === "payment_history" ? (
            <div className="rounded-[18px] border border-dashed border-[#D6DCE0] bg-[#F8FAFB] p-4 text-sm font-semibold text-[#6B747B]">
              Payment history will be connected after the payment ledger is added.
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 px-3 text-sm font-semibold text-[#6B747B]">Close</button>
          <button type="button" disabled className="min-h-10 rounded-[10px] bg-[#26323A] px-4 text-sm font-semibold text-white opacity-50">Workflow pending</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FinanceWorkflowBlock({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-[#E1E8EC] bg-[#FAFCFC] p-4">
      <h3 className="text-sm font-semibold text-[#26323A]">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-[#6B747B]">{text}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function financePaymentType(row: FinanceEnrollmentRow, program: Program | null) {
  if (!program?.is_paid) {
    return "Free";
  }
  if (row.request?.payment_bypassed) {
    return "Waived";
  }
  if (row.subscription?.stripe_subscription_id) {
    return "Monthly";
  }
  return "Monthly";
}

function financePrice(row: FinanceEnrollmentRow, program: Program | null) {
  if (row.request?.payment_bypassed) {
    return "Waived";
  }
  return formatPrice(row.request?.approved_price_monthly_cents ?? program?.price_monthly_cents ?? null);
}

function financeStatus(row: FinanceEnrollmentRow) {
  void row;
  return "Active";
}

function financeStudentType(row: FinanceEnrollmentRow) {
  return row.parent ? "child" : "adult";
}

function financeMonthlyAmountCents(row: FinanceEnrollmentRow, program: Program | null) {
  if (!program?.is_paid || row.request?.payment_bypassed) {
    return 0;
  }
  if (financePaymentType(row, program).toLowerCase() !== "monthly") {
    return 0;
  }
  return row.request?.approved_price_monthly_cents ?? program.price_monthly_cents ?? 0;
}

function financeTimesPaid(row: FinanceEnrollmentRow) {
  if (row.request?.payment_bypassed) {
    return "0";
  }
  if (row.request?.admission_completed_at || row.subscription?.current_period_start) {
    return row.subscription?.stripe_subscription_id ? "1+" : "1";
  }
  return "0";
}

function financeAuditFallbackSummary(row: FinanceEnrollmentRow, program: Program) {
  const actor = row.approver?.full_name ?? "Director";
  const student = row.student?.full_name || "Student";
  if (row.request?.payment_bypassed) {
    return `${actor} waived payment indefinitely for ${student}.`;
  }
  if (row.subscription?.stripe_subscription_id) {
    return `Parent paid and subscription is active for ${student}.`;
  }
  if (row.request?.approved_price_monthly_cents) {
    return `${actor} changed ${student}'s price to ${formatPrice(row.request.approved_price_monthly_cents)}/month.`;
  }
  if (program.is_paid) {
    return `Payment link was sent for ${student}.`;
  }
  return `${student} was admitted into ${program.title}.`;
}

function formatFinanceDate(value: string | null | undefined) {
  if (!value) {
    return "Not synced";
  }
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function useMosquePrograms(slug: string) {
  const cachedSnapshot = mosqueProgramsCache.get(slug);
  const [mosque, setMosque] = useState<Mosque | null>(cachedSnapshot?.mosque ?? null);
  const [programs, setPrograms] = useState<ProgramWithTeacher[]>(cachedSnapshot?.programs ?? []);
  const [loading, setLoading] = useState(!cachedSnapshot);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await loadMosqueProgramsSnapshot(slug);
        if (!cancelled) {
          setMosque(snapshot.mosque);
          setPrograms(snapshot.programs);
          setError(null);
          setLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load programs.");
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { mosque, programs, loading, error };
}

async function loadMosqueProgramsSnapshot(slug: string) {
  const cached = mosqueProgramsCache.get(slug);
  if (cached) {
    return cached;
  }

  const existing = mosqueProgramsPromises.get(slug);
  if (existing) {
    return existing;
  }

  const promise = fetchMosqueProgramsSnapshot(slug).finally(() => {
    mosqueProgramsPromises.delete(slug);
  });

  mosqueProgramsPromises.set(slug, promise);
  return promise;
}

async function fetchMosqueProgramsSnapshot(slug: string): Promise<MosqueProgramsSnapshot> {
  const supabase = createSupabaseBrowserClient();
  const { data: mosqueData, error: mosqueError } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();

  if (mosqueError) {
    throw new Error(mosqueError.message);
  }

  if (!mosqueData) {
    throw new Error("Masjid not found.");
  }

  const { data: programData, error: programError } = await supabase
    .from("programs")
    .select("*")
    .eq("mosque_id", mosqueData.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (programError) {
    throw new Error(programError.message);
  }

  const teacherIds = Array.from(new Set((programData ?? []).map((program) => program.director_profile_id ?? program.teacher_profile_id).filter(Boolean))) as string[];
  let teachers: TeacherDisplay[] = [];

  if (teacherIds.length > 0) {
    const { data: teacherData, error: teacherError } = await supabase.from("profiles").select("id, full_name, avatar_url, teacher_credentials, teacher_whatsapp_number").in("id", teacherIds);
    if (teacherError) {
      throw new Error(teacherError.message);
    }
    teachers = teacherData ?? [];
  }

  const snapshot = {
    mosque: mosqueData,
    programs: (programData ?? []).map((program) => ({
      ...program,
      teacher: teachers.find((teacher) => teacher.id === (program.director_profile_id ?? program.teacher_profile_id)) ?? null,
    })),
  };

  mosqueProgramsCache.set(slug, snapshot);
  return snapshot;
}

function useTeacherPrograms(slug: string) {
  const [programs, setPrograms] = useState<ProgramScheduleSource[]>([]);
  const [allPrograms, setAllPrograms] = useState<ProgramScheduleSource[]>([]);
  const [roleByProgramId, setRoleByProgramId] = useState<Record<string, TeacherProgramRole>>({});
  const [financeAccessByProgramId, setFinanceAccessByProgramId] = useState<Record<string, boolean>>({});
  const [canCreateClass, setCanCreateClass] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const session = await loadCachedSession();
      if (!active) {
        return;
      }

      const userId = session?.user.id;
      if (!userId) {
        setPrograms([]);
        setAllPrograms([]);
        setRoleByProgramId({});
        setFinanceAccessByProgramId({});
        setCanCreateClass(false);
        setCurrentUserId(null);
        setError("Log in required.");
        setLoading(false);
        return;
      }

      setCurrentUserId(userId);
      const [{ data: mosque, error: mosqueError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.from("mosques").select("id").eq("slug", slug).maybeSingle(),
        supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
      ]);
      if (mosqueError) {
        if (active) {
          setError(mosqueError.message);
          setLoading(false);
        }
        return;
      }
      if (profileError) {
        if (active) {
          setError(profileError.message);
          setLoading(false);
        }
        return;
      }

      const teacherAccountType = profile?.account_type?.toLowerCase() ?? null;
      if (teacherAccountType !== "teacher" && teacherAccountType !== "admin") {
        if (active) {
          setPrograms([]);
          setAllPrograms([]);
          setRoleByProgramId({});
          setFinanceAccessByProgramId({});
          setCanCreateClass(false);
          setError("Teacher account required.");
          setLoading(false);
        }
        return;
      }

      if (!mosque) {
        if (active) {
          setPrograms([]);
          setAllPrograms([]);
          setRoleByProgramId({});
          setFinanceAccessByProgramId({});
          setCanCreateClass(false);
          setLoading(false);
        }
        return;
      }

      const [{ data: mosquePrograms, error: programError }, { data: assignments, error: assignmentError }, { data: memberships }] = await Promise.all([
        supabase.from("programs").select("*").eq("mosque_id", mosque.id).eq("is_active", true).order("title", { ascending: true }),
        supabase.from("program_teachers").select("program_id, role, can_manage_finances").eq("teacher_profile_id", userId),
        supabase.from("mosque_memberships").select("role, status, can_create_programs").eq("mosque_id", mosque.id).eq("profile_id", userId),
      ]);

      if (programError || assignmentError) {
        if (active) {
          setError(programError?.message ?? assignmentError?.message ?? "Could not load assigned classes.");
          setLoading(false);
        }
        return;
      }

      const assignmentRoleByProgramId = Object.fromEntries(
        (assignments ?? []).map((assignment) => [assignment.program_id, assignment.role === "director" ? "director" : "instructor" as TeacherProgramRole]),
      ) as Record<string, TeacherProgramRole>;
      const programIds = (mosquePrograms ?? []).map((program) => program.id);
      const { data: trackRows } = programIds.length
        ? await supabase.from("program_tracks").select("*").in("program_id", programIds).eq("is_active", true).order("sort_order", { ascending: true })
        : { data: [] as ProgramTrack[] };
      const programsWithTracks = (mosquePrograms ?? []).map((program) => ({
        ...program,
        scheduleTracks: (trackRows ?? []).filter((track) => track.program_id === program.id),
      }));
      if (active) {
        const nextRoleByProgramId: Record<string, TeacherProgramRole> = {};
        const nextFinanceAccessByProgramId: Record<string, boolean> = {};
        const isAdminForMosque = teacherAccountType === "admin" && (memberships ?? []).some((membership) => membership.role === "admin" && membership.status === "active");
        const canCreateForMosque = isAdminForMosque || (teacherAccountType === "teacher" && (memberships ?? []).some((membership) => membership.role === "teacher" && membership.status === "active" && membership.can_create_programs));
        const assignedPrograms = isAdminForMosque ? programsWithTracks : programsWithTracks.filter((program) => {
          const isDirector = (program.director_profile_id ?? program.teacher_profile_id) === userId || assignmentRoleByProgramId[program.id] === "director";
          const assignedRole = isDirector ? "director" : assignmentRoleByProgramId[program.id];
          if (assignedRole) {
            nextRoleByProgramId[program.id] = assignedRole;
            nextFinanceAccessByProgramId[program.id] = assignedRole === "director" && Boolean((assignments ?? []).find((assignment) => assignment.program_id === program.id && assignment.role === "director")?.can_manage_finances);
            return true;
          }
          return false;
        });
        if (isAdminForMosque) {
          for (const program of assignedPrograms) {
            nextRoleByProgramId[program.id] = "director";
            nextFinanceAccessByProgramId[program.id] = true;
          }
        }
        setAllPrograms(programsWithTracks);
        setRoleByProgramId(nextRoleByProgramId);
        setFinanceAccessByProgramId(nextFinanceAccessByProgramId);
        setPrograms(assignedPrograms);
        setCanCreateClass(canCreateForMosque);
        setLoading(false);
      }
    }

    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [slug]);

  return { programs, allPrograms, roleByProgramId, financeAccessByProgramId, canCreateClass, currentUserId, loading, error };
}

function useAdminProgramsWithTracks(slug: string) {
  const [programs, setPrograms] = useState<ProgramScheduleSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      const session = await loadCachedSession();
      const userId = session?.user.id;
      if (!userId) {
        if (active) {
          setPrograms([]);
          setError("Log in required.");
          setLoading(false);
        }
        return;
      }

      const [{ data: mosque, error: mosqueError }, { data: profile }] = await Promise.all([
        supabase.from("mosques").select("id").eq("slug", slug).maybeSingle(),
        supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
      ]);

      if (mosqueError || !mosque) {
        if (active) {
          setPrograms([]);
          setError(mosqueError?.message ?? "Masjid not found.");
          setLoading(false);
        }
        return;
      }

      const { data: adminMembership } = await supabase
        .from("mosque_memberships")
        .select("id")
        .eq("mosque_id", mosque.id)
        .eq("profile_id", userId)
        .eq("role", "admin")
        .eq("status", "active")
        .maybeSingle();

      if (profile?.account_type !== "admin" || !adminMembership) {
        if (active) {
          setPrograms([]);
          setError("Admin account required.");
          setLoading(false);
        }
        return;
      }

      const { data: programRows, error: programError } = await supabase
        .from("programs")
        .select("*")
        .eq("mosque_id", mosque.id)
        .eq("is_active", true)
        .order("title", { ascending: true });

      if (programError) {
        if (active) {
          setError(programError.message);
          setLoading(false);
        }
        return;
      }

      const programIds = (programRows ?? []).map((program) => program.id);
      const { data: trackRows } = programIds.length
        ? await supabase
            .from("program_tracks")
            .select("*")
            .in("program_id", programIds)
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
        : { data: [] as ProgramTrack[] };

      if (active) {
        setPrograms(
          (programRows ?? []).map((program) => ({
            ...program,
            scheduleTracks: (trackRows ?? []).filter((track) => track.program_id === program.id),
          })),
        );
        setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [slug]);

  return { programs, loading, error };
}

function useStudentPrograms(slug: string) {
  const base = useMosquePrograms(slug);
  const [enrolledProgramIds, setEnrolledProgramIds] = useState<string[]>([]);
  const [programOwnerLabels, setProgramOwnerLabels] = useState<Record<string, string[]>>({});
  const [programTracksByProgramId, setProgramTracksByProgramId] = useState<Record<string, ProgramTrack[]>>({});
  const [accountType, setAccountType] = useState<string | null>(null);
  const [enrollmentLoading, setEnrollmentLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    async function loadEnrollments() {
      if (active) {
        setEnrollmentLoading(true);
      }

      const session = await loadCachedSession();
      if (!active) {
        return;
      }

      const userId = session?.user.id;
      if (!userId) {
        if (active) {
          setEnrolledProgramIds([]);
          setProgramOwnerLabels({});
          setProgramTracksByProgramId({});
          setAccountType(null);
          setEnrollmentLoading(false);
        }
        return;
      }

      const [{ data: profile }, { data: mosque }] = await Promise.all([
        supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
        supabase.from("mosques").select("id").eq("slug", slug).maybeSingle(),
      ]);

      const nextAccountType = profile?.account_type ?? null;
      if (nextAccountType === "parent" && mosque?.id) {
        const { children } = await fetchParentChildren(supabase, slug, userId, mosque.id);
        const childIds = children.map((child) => child.id);
        if (childIds.length === 0) {
          if (active) {
            setEnrolledProgramIds([]);
            setProgramOwnerLabels({});
            setProgramTracksByProgramId({});
            setAccountType(nextAccountType);
            setEnrollmentLoading(false);
          }
          return;
        }

        const { data } = await supabase.from("enrollments").select("id, program_id, student_profile_id").in("student_profile_id", childIds);
        const childNameById = new Map(children.map((child) => [child.id, child.full_name?.trim() || "Child"]));
        const owners: Record<string, string[]> = {};
        for (const row of data ?? []) {
          const childName = childNameById.get(row.student_profile_id);
          if (!childName) {
            continue;
          }
          owners[row.program_id] = Array.from(new Set([...(owners[row.program_id] ?? []), childName]));
        }
        const trackMap = await loadEnrollmentTrackMap(supabase, data ?? []);
        if (active) {
          setEnrolledProgramIds(Object.keys(owners));
          setProgramOwnerLabels(owners);
          setProgramTracksByProgramId(trackMap);
          setAccountType(nextAccountType);
          setEnrollmentLoading(false);
        }
        return;
      }

      const { data } = await supabase.from("enrollments").select("id, program_id").eq("student_profile_id", userId);
      const trackMap = await loadEnrollmentTrackMap(supabase, data ?? []);
      if (active) {
        setEnrolledProgramIds((data ?? []).map((row) => row.program_id));
        setProgramOwnerLabels({});
        setProgramTracksByProgramId(trackMap);
        setAccountType(nextAccountType);
        setEnrollmentLoading(false);
      }
    }

    void loadEnrollments();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadEnrollments();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [slug]);

  return { ...base, enrolledProgramIds, programOwnerLabels, programTracksByProgramId, accountType, enrollmentLoading };
}

async function loadEnrollmentTrackMap(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  enrollments: Array<{ id: string; program_id: string }>,
) {
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
  if (!enrollmentIds.length) {
    return {};
  }

  const { data: enrollmentTracks } = await supabase
    .from("enrollment_tracks")
    .select("enrollment_id, program_track_id")
    .in("enrollment_id", enrollmentIds);
  const trackIds = Array.from(new Set((enrollmentTracks ?? []).map((row) => row.program_track_id).filter(Boolean))) as string[];
  if (!trackIds.length) {
    return {};
  }

  const { data: tracks } = await supabase
    .from("program_tracks")
    .select("*")
    .in("id", trackIds)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const trackById = new Map((tracks ?? []).map((track) => [track.id, track]));
  const enrollmentProgramById = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment.program_id]));
  const next: Record<string, ProgramTrack[]> = {};

  for (const row of enrollmentTracks ?? []) {
    const programId = enrollmentProgramById.get(row.enrollment_id);
    const track = trackById.get(row.program_track_id);
    if (!programId || !track) {
      continue;
    }
    next[programId] = [...(next[programId] ?? []).filter((item) => item.id !== track.id), track];
  }

  return next;
}

function useStudentUnreadAnnouncements(slug: string) {
  const { announcementCount, noteCount } = useStudentNotificationCounts(slug);
  return { unreadCount: announcementCount + noteCount };
}

async function fetchParentChildren(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  slug: string,
  parentId: string,
  knownMosqueId?: string,
) {
  let mosqueId = knownMosqueId ?? null;
  if (!mosqueId) {
    const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
    mosqueId = mosque?.id ?? null;
  }

  if (!mosqueId) {
    return { mosqueId: null, children: [] as StudentDisplay[] };
  }

  const { data: links } = await supabase
    .from("parent_child_links")
    .select("child_profile_id")
    .eq("parent_profile_id", parentId)
    .eq("mosque_id", mosqueId);

  const childIds = (links ?? []).map((link) => link.child_profile_id);
  if (childIds.length === 0) {
    return { mosqueId, children: [] as StudentDisplay[] };
  }

  const { data: children } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type")
    .in("id", childIds);

  return { mosqueId, children: (children ?? []) as StudentDisplay[] };
}

export function useStudentNotificationCounts(slug: string) {
  const cachedCounts = notificationCountsCache.get(slug);
  const [announcementCount, setAnnouncementCount] = useState(cachedCounts?.announcementCount ?? 0);
  const [noteCount, setNoteCount] = useState(cachedCounts?.noteCount ?? 0);
  const [requestCount, setRequestCount] = useState(cachedCounts?.requestCount ?? 0);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    function setCounts(nextCounts: NotificationCounts) {
      notificationCountsCache.set(slug, nextCounts);
      if (active) {
        setAnnouncementCount(nextCounts.announcementCount);
        setNoteCount(nextCounts.noteCount);
        setRequestCount(nextCounts.requestCount);
      }
    }

    async function load() {
      if (!slug) {
        setCounts({ announcementCount: 0, noteCount: 0, requestCount: 0 });
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setCounts({ announcementCount: 0, noteCount: 0, requestCount: 0 });
        return;
      }

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setCounts({ announcementCount: 0, noteCount: 0, requestCount: 0 });
        return;
      }

      const { data: profile } = await supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle();
      const { children } = profile?.account_type === "parent" ? await fetchParentChildren(supabase, slug, userId, mosque.id) : { children: [] as StudentDisplay[] };
      const targetStudentIds = profile?.account_type === "parent" ? children.map((child) => child.id) : [userId];
      const [{ data: enrollments }, { data: requestRows }, { data: withdrawalRows }, { data: noteRows }] = await Promise.all([
        targetStudentIds.length
          ? supabase.from("enrollments").select("id, program_id, student_profile_id, program_track_id").in("student_profile_id", targetStudentIds)
          : Promise.resolve({ data: [] as EnrollmentTrackSelection[] }),
        profile?.account_type === "parent"
          ? supabase
              .from("enrollment_requests")
              .select("id, status, reviewed_at, requested_at")
              .eq("mosque_id", mosque.id)
              .eq("parent_profile_id", userId)
              .neq("status", "pending")
              .is("student_dismissed_at", null)
          : supabase
              .from("enrollment_requests")
              .select("id, status, reviewed_at, requested_at")
              .eq("mosque_id", mosque.id)
              .eq("student_profile_id", userId)
              .neq("status", "pending")
              .is("student_dismissed_at", null),
        profile?.account_type === "parent"
          ? supabase
              .from("withdrawal_requests")
              .select("id, status, reviewed_at, requested_at")
              .eq("mosque_id", mosque.id)
              .or(`parent_profile_id.eq.${userId},requested_by.eq.${userId}`)
              .neq("status", "pending")
              .is("student_dismissed_at", null)
          : supabase
              .from("withdrawal_requests")
              .select("id, status, reviewed_at, requested_at")
              .eq("mosque_id", mosque.id)
              .eq("student_profile_id", userId)
              .neq("status", "pending")
              .is("student_dismissed_at", null),
        targetStudentIds.length
          ? supabase.from("program_student_notes").select("id, seen_at").in("student_profile_id", targetStudentIds)
          : Promise.resolve({ data: [] as Array<{ id: string; seen_at: string | null }> }),
      ]);

      const seenRequestIds = readSeenNotificationIds(seenStudentRequestsStorageKey, userId);
      const nextRequestCount =
        (requestRows ?? []).filter((request) => !seenRequestIds.has(studentRequestNotificationKey(request))).length +
        (withdrawalRows ?? []).filter((request) => !seenRequestIds.has(studentWithdrawalNotificationKey(request))).length;
      const nextNoteCount = (noteRows ?? []).filter((note) => !note.seen_at).length;

      const enrollmentRows = (enrollments ?? []) as EnrollmentTrackSelection[];
      const enrollmentIds = enrollmentRows.map((enrollment) => enrollment.id);
      const { data: enrollmentTrackRows } = enrollmentIds.length
        ? await supabase.from("enrollment_tracks").select("enrollment_id, program_track_id").in("enrollment_id", enrollmentIds)
        : { data: [] as Array<{ enrollment_id: string; program_track_id: string }> };
      const enrolledTrackIdsByProgramId = getEnrollmentTrackIdsByProgram(enrollmentRows, enrollmentTrackRows ?? []);
      const programIds = enrollmentRows.map((row) => row.program_id);
      if (programIds.length === 0) {
        setCounts({ announcementCount: 0, noteCount: nextNoteCount, requestCount: nextRequestCount });
        return;
      }

      const { data: announcements } = await supabase.from("program_announcements").select("id, program_id, target_program_track_ids").in("program_id", programIds);
      const visibleAnnouncements = (announcements ?? []).filter((announcement) =>
        isAnnouncementVisibleForEnrollment(announcement as Pick<AnnouncementWithContext, "target_program_track_ids">, enrolledTrackIdsByProgramId.get(announcement.program_id)),
      );
      const announcementIds = visibleAnnouncements.map((item) => item.id);
      if (announcementIds.length === 0) {
        setCounts({ announcementCount: 0, noteCount: nextNoteCount, requestCount: nextRequestCount });
        return;
      }

      const { data: receipts } = await supabase
        .from("program_announcement_receipts")
        .select("announcement_id, read_at, dismissed_at")
        .eq("profile_id", userId)
        .in("announcement_id", announcementIds);
      const readOrDismissed = new Set((receipts ?? []).filter((receipt) => receipt.read_at || receipt.dismissed_at).map((receipt) => receipt.announcement_id));
      setCounts({ announcementCount: announcementIds.filter((id) => !readOrDismissed.has(id)).length, noteCount: nextNoteCount, requestCount: nextRequestCount });
    }

    void load();
    window.addEventListener("tareeqah:notifications-changed", load);
    return () => {
      active = false;
      window.removeEventListener("tareeqah:notifications-changed", load);
    };
  }, [slug]);

  return { announcementCount, noteCount, requestCount, totalCount: announcementCount + noteCount + requestCount };
}

export function useTeacherNotificationCounts(slug: string) {
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    async function load() {
      if (!slug) {
        setRequestCount(0);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        if (active) {
          setRequestCount(0);
        }
        return;
      }

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        if (active) {
          setRequestCount(0);
        }
        return;
      }

      const [{ data: mosquePrograms }, { data: assignments }] = await Promise.all([
        supabase.from("programs").select("id, teacher_profile_id, director_profile_id").eq("mosque_id", mosque.id).eq("is_active", true),
        supabase.from("program_teachers").select("program_id, role").eq("teacher_profile_id", userId),
      ]);
      const directorAssignmentIds = new Set((assignments ?? []).filter((assignment) => assignment.role === "director").map((assignment) => assignment.program_id));
      const programIds = (mosquePrograms ?? [])
        .filter((program) => (program.director_profile_id ?? program.teacher_profile_id) === userId || directorAssignmentIds.has(program.id))
        .map((program) => program.id);

      if (programIds.length === 0) {
        if (active) {
          setRequestCount(0);
        }
        return;
      }

      const [{ data: rows }, { data: withdrawalRows }, { data: instructorRows }, { data: instructorEventRows }] = await Promise.all([
        supabase
          .from("enrollment_requests")
          .select("id, requested_at, admission_completed_at")
          .in("program_id", programIds)
          .is("teacher_dismissed_at", null)
          .or("status.eq.pending,admission_completed_at.not.is.null"),
        supabase.from("withdrawal_requests").select("id").in("program_id", programIds).eq("status", "pending").is("teacher_dismissed_at", null),
        supabase
          .from("program_teachers")
          .select("id, teacher_profile_id")
          .in("program_id", programIds)
          .eq("role", "instructor")
          .not("teacher_profile_id", "is", null),
        supabase
          .from("program_instructor_events")
          .select("id, assignment_id, teacher_profile_id, event_type")
          .in("program_id", programIds),
      ]);
      const seenRequestIds = readSeenNotificationIds(seenTeacherRequestsStorageKey, userId);
      if (active) {
        const unseenApplications = (rows ?? []).filter((row) => !seenRequestIds.has(teacherRequestNotificationKey(row))).length;
        const joinedAssignmentIdsWithEvents = new Set((instructorEventRows ?? []).filter((event) => event.event_type === "joined" && event.assignment_id).map((event) => event.assignment_id as string));
        const eventInstructorNotifications: Array<Pick<InstructorLifecycleNotification, "id" | "event_type" | "teacher_profile_id">> = (instructorEventRows ?? []).map((event) => ({
          id: event.id,
          event_type: event.event_type === "resigned" ? "resigned" : "joined",
          teacher_profile_id: event.teacher_profile_id,
        }));
        const fallbackInstructorNotifications = (instructorRows ?? [])
          .filter((row) => !joinedAssignmentIdsWithEvents.has(row.id))
          .map((row) => ({ id: row.id, event_type: "joined" as const, teacher_profile_id: row.teacher_profile_id }));
        const unseenInstructors = [...eventInstructorNotifications, ...fallbackInstructorNotifications].filter((row) => !seenRequestIds.has(teacherInstructorNotificationKey(row))).length;
        setRequestCount(unseenApplications + unseenInstructors + (withdrawalRows ?? []).length);
      }
    }

    void load();
    window.addEventListener("tareeqah:notifications-changed", load);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    return () => {
      active = false;
      window.removeEventListener("tareeqah:notifications-changed", load);
      subscription.unsubscribe();
    };
  }, [slug]);

  return { requestCount, totalCount: requestCount };
}

function FloatingInboxTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; badge?: number }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex justify-center gap-4 border-b border-[#D6DCE0] bg-[var(--workspace)]">
        {tabs.map((tab) => {
          const active = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative min-h-11 min-w-0 px-2 text-[12px] font-medium transition",
                tab.badge ? "pr-7" : "",
                active ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]",
              )}
            >
              <span className="block whitespace-nowrap text-center">{tab.label}</span>
              {tab.badge ? <NotificationBadge count={tab.badge} className="right-0 top-1" /> : null}
            </button>
          );
        })}
    </div>
  );
}

function NotificationBadge({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span className={cn("absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E25241] px-1 text-[11px] font-semibold leading-none text-white shadow-[0_4px_10px_rgba(226,82,65,0.35)] ring-2 ring-white", className)}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

function InboxSection({ title, count, children, action }: { title: string; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-10 items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold text-[#26323A]">{title}</h2>
        <div className="flex items-center gap-2">
          <span className="min-w-8 rounded-full bg-[#E8F7F2] px-2.5 py-1 text-center text-xs font-semibold text-[#17624F]">{count}</span>
          {action}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function TeacherRequestSection({ title, count, children, action }: { title: string; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-10 items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold text-[#26323A]">{title}</h2>
        <div className="flex items-center gap-2">
          <span className="min-w-8 rounded-full bg-[#E8F7F2] px-2.5 py-1 text-center text-xs font-semibold text-[#17624F]">{count}</span>
          {action}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ClearAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-1.5 py-1 text-xs font-semibold text-[#6B747B] underline-offset-2 transition-colors hover:text-[#26323A] hover:underline">
      Clear all
    </button>
  );
}

function MiniEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[#D6DCE0] px-4 py-6 text-center text-sm text-[#6B747B]">{text}</div>;
}

function buildAnnouncementThreads(announcements: AnnouncementWithContext[], enrolledPrograms: Program[] = []) {
  const byProgram = new Map<string, AnnouncementWithContext[]>();
  for (const announcement of announcements) {
    byProgram.set(announcement.program_id, [...(byProgram.get(announcement.program_id) ?? []), announcement]);
  }

  const programIds = Array.from(new Set([...enrolledPrograms.map((program) => program.id), ...Array.from(byProgram.keys())]));

  return programIds
    .map((programId) => {
      const rows = byProgram.get(programId) ?? [];
      const sorted = rows.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return {
        programId,
        program: sorted[0]?.program ?? enrolledPrograms.find((program) => program.id === programId) ?? null,
        latest: sorted[0],
        unreadCount: sorted.filter((announcement) => !announcement.receipt?.read_at).length,
      };
    })
    .sort((a, b) => Date.parse(b.latest?.created_at ?? "0") - Date.parse(a.latest?.created_at ?? "0"));
}

function buildNoteThreads(notes: StudentNoteWithContext[]) {
  const byThread = new Map<string, StudentNoteWithContext[]>();
  for (const note of notes) {
    const key = `${note.program_id}:${note.student_profile_id}`;
    byThread.set(key, [...(byThread.get(key) ?? []), note]);
  }

  return Array.from(byThread.entries())
    .map(([_key, rows]) => {
      const sorted = rows.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const latest = sorted[0];
      return {
        programId: latest?.program_id ?? "",
        studentId: latest?.student_profile_id ?? "",
        program: latest?.program ?? null,
        student: latest?.student ?? null,
        latest,
        unreadCount: sorted.filter((note) => !note.seen_at).length,
      };
    })
    .filter((thread): thread is { programId: string; studentId: string; program: Program | null; student: StudentDisplay | null; latest: StudentNoteWithContext; unreadCount: number } => Boolean(thread.latest))
    .sort((a, b) => Date.parse(b.latest.created_at) - Date.parse(a.latest.created_at));
}

function InboxLoadingPanel({ label }: { label: string }) {
  return <GenericLoadingState label={label} />;
}

function GenericLoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center bg-[var(--workspace)] px-6 py-10" aria-label={label}>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-11 w-11 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" aria-hidden />
        <span className="text-sm font-semibold text-[#52616A]">Loading</span>
      </div>
    </div>
  );
}

function StudentAnnouncementStream({ announcements }: { announcements: AnnouncementWithContext[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#D6DCE0] bg-white shadow-[0_8px_22px_rgba(38,50,58,0.06)]">
      <div className="max-h-[430px] space-y-4 overflow-y-auto p-4">
        {announcements.length ? (
          announcements.map((announcement) => <StudentAnnouncementCard key={announcement.id} announcement={announcement} />)
        ) : (
          <MiniEmpty text="Class announcements will appear here." />
        )}
      </div>
    </section>
  );
}

function StudentAnnouncementCard({ announcement }: { announcement: AnnouncementWithContext }) {
  return (
    <article className="flex gap-3">
      <Avatar src={announcement.author?.avatar_url ?? null} name={announcement.author?.full_name ?? "Teacher"} />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[#E1E8EC] bg-[#FAFBFC] p-3 shadow-[0_6px_18px_rgba(38,50,58,0.05)]">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-[#26323A]">{announcement.author?.full_name ?? "Teacher"}</h3>
          <span className="text-xs text-[#6B747B]">{timeAgo(announcement.created_at)}</span>
        </div>
        <p className="mt-0.5 text-xs font-medium text-[#2F8FB3]">{announcement.program?.title ?? "Class announcement"}</p>
        <p className="mt-2 text-sm leading-6 text-[#26323A]">{announcement.message}</p>
      </div>
    </article>
  );
}

function ProgramAnnouncementFeed({
  program,
  announcements,
  readersByAnnouncementId = {},
  viewer,
}: {
  program: Program | null;
  announcements: AnnouncementWithContext[];
  readersByAnnouncementId?: Record<string, Profile[]>;
  viewer: "teacher" | "student";
}) {
  return (
    <section className="space-y-4 bg-white px-4 pb-28 pt-4 text-[#26323A]">
      {program ? (
        <div className="px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">{viewer === "teacher" ? "Announcement feed" : "Class announcements"}</p>
          <h2 className="mt-1 text-2xl font-semibold leading-8">{program.title}</h2>
          <p className="mt-1 text-sm text-[#6B747B]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
        </div>
      ) : null}
      <div className="space-y-4">
        {announcements.length ? (
          announcements.map((announcement) => (
            <TeacherAnnouncementBubble
              key={announcement.id}
              announcement={announcement}
              readers={readersByAnnouncementId[announcement.id] ?? []}
              showSeenDetails={viewer === "teacher"}
            />
          ))
        ) : (
          <MiniEmpty text="No announcements have been sent for this class." />
        )}
      </div>
    </section>
  );
}

function AnnouncementTrackTargetControls({
  tracks,
  mode,
  selectedTrackIds,
  onModeChange,
  onToggleTrack,
}: {
  tracks: ProgramTrack[];
  mode: "all" | "tracks";
  selectedTrackIds: string[];
  onModeChange: (mode: "all" | "tracks") => void;
  onToggleTrack: (trackId: string) => void;
}) {
  if (tracks.length === 0) {
    return (
      <div className="rounded-[14px] border border-[#DDE6EA] bg-white px-3 py-3 text-sm text-[#6B747B]">
        This announcement will go to the whole class.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[16px] border border-[#DDE6EA] bg-white p-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onModeChange("all")}
          className={cn(
            "min-h-10 rounded-full px-3 text-sm font-semibold transition",
            mode === "all" ? "bg-[#17624F] text-white shadow-[0_8px_18px_rgba(23,98,79,0.18)]" : "bg-[#EEF3F5] text-[#52616A]",
          )}
        >
          Whole program
        </button>
        <button
          type="button"
          onClick={() => onModeChange("tracks")}
          className={cn(
            "min-h-10 rounded-full px-3 text-sm font-semibold transition",
            mode === "tracks" ? "bg-[#17624F] text-white shadow-[0_8px_18px_rgba(23,98,79,0.18)]" : "bg-[#EEF3F5] text-[#52616A]",
          )}
        >
          Specific tracks
        </button>
      </div>
      {mode === "tracks" ? (
        <div className="grid gap-2">
          {tracks.map((track) => {
            const selected = selectedTrackIds.includes(track.id);
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => onToggleTrack(track.id)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-[14px] border px-3 text-left text-sm font-semibold transition",
                  selected ? "border-[#17624F] bg-[#E8F7F2] text-[#17624F]" : "border-[#DDE6EA] bg-white text-[#52616A]",
                )}
              >
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#B9C3C8] bg-white")} aria-hidden>
                  {selected ? "✓" : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{track.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function StudentNoteBubble({ note, viewer }: { note: StudentNoteWithContext; viewer: "teacher" | "recipient" }) {
  const authorName = note.author?.full_name?.trim() || "Teacher";
  const seen = Boolean(note.seen_at);
  return (
    <article className="flex gap-3">
      <Avatar src={note.author?.avatar_url ?? null} name={authorName} />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[#E1E8EC] bg-white p-3 shadow-[0_6px_18px_rgba(38,50,58,0.05)]">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-[#26323A]">{authorName}</h3>
          <span className="text-xs text-[#6B747B]">{timeAgo(note.created_at)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#F0F3F5] px-2 py-0.5 text-[11px] font-semibold text-[#52616A]">{note.program?.title ?? "Class"}</span>
          <span className="rounded-full bg-[#EAF4F7] px-2 py-0.5 text-[11px] font-semibold text-[#2F6F83]">Subject: {note.student?.full_name ?? "Student"}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#26323A]">{note.message}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#6B747B]">
          <span>{seen ? `Seen ${note.seen_at ? timeAgo(note.seen_at) : ""}` : "Not seen"}</span>
          {viewer === "recipient" && !seen ? <span className="font-semibold text-[#2F8FB3]">Marked seen</span> : null}
        </div>
      </div>
    </article>
  );
}

function StudentRequestCard({
  request,
  onRescind,
  onDismiss,
  onCompleteRegistration,
  checkoutBusy = false,
}: {
  request: RequestWithContext;
  onRescind?: () => void;
  onDismiss?: () => void;
  onCompleteRegistration?: () => void;
  checkoutBusy?: boolean;
}) {
  const statusLabel = studentRequestStatusLabel(request);
  const statusTime = request.reviewed_at ?? request.requested_at;
  const childName = request.parent_profile_id ? request.student?.full_name?.trim() : null;
  const isPaymentRequest = Boolean(onCompleteRegistration);
  const reviewedMessage = request.review_note ?? request.decision_note;
  const message =
    request.status === "pending"
      ? null
      : reviewedMessage ??
        (isPaymentRequest
          ? "Your teacher approved this request. Complete registration to activate the class."
          : request.status === "approved"
            ? request.payment_bypassed
              ? "You have been admitted."
              : "Your request was approved."
            : request.status === "waitlisted"
              ? "You have been waitlisted and will be notified once a spot is available."
              : request.status === "cancelled"
                ? `You were removed from ${request.program?.title ?? "this class"}.`
                : null);
  return (
    <article className={cn("rounded-xl border border-[#E1E8EC] bg-white p-3", (isPaymentRequest || request.payment_bypassed) && "border-[#CFE8D6] bg-[#FBFEFC]", request.status === "waitlisted" && "border-[#FFE3A3] bg-[#FFFDF7]")}>
      <div className="flex items-start gap-3">
        <DefaultProfileIcon />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-5 text-[#26323A]">{request.program?.title ?? "Class request"}</h3>
              <p className="mt-0.5 text-xs text-[#6B747B]">
                {childName ? `${childName} • ` : ""}
                {statusLabel} • {timeAgo(statusTime)}
              </p>
            </div>
            {onDismiss ? (
              <button type="button" onClick={onDismiss} className="-mr-1 -mt-1 p-1 text-[#C83F31] transition-colors hover:text-[#9D2E23]" aria-label="Clear notification">
                <XIcon />
              </button>
            ) : null}
          </div>
          {message ? <p className="mt-2 text-sm leading-5 text-[#26323A]">{message}</p> : null}
          {onCompleteRegistration ? (
            <button
              type="button"
              onClick={onCompleteRegistration}
              disabled={checkoutBusy}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-[6px] bg-[#2E6E52] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(46,110,82,0.22)] transition-colors hover:bg-[#265D45] disabled:opacity-60"
            >
              {checkoutBusy ? "Opening checkout..." : "Complete registration"}
            </button>
          ) : null}
        </div>
        {onRescind ? <IconActionButton label="Rescind" tone="danger" onClick={onRescind} /> : null}
      </div>
    </article>
  );
}

function StudentWithdrawalStatusCard({ request, onDismiss }: { request: WithdrawalRequestWithContext; onDismiss?: () => void }) {
  const statusTime = request.reviewed_at ?? request.requested_at;
  const studentName = request.student?.full_name?.trim();
  const statusLabel = request.status === "approved" ? "Withdrawal approved" : request.status === "rejected" ? "Withdrawal rejected" : "Withdrawal pending";
  const message =
    request.decision_note ??
    (request.status === "approved"
      ? "The student was removed from this class immediately."
      : request.status === "rejected"
        ? "The student remains enrolled in this class."
        : "The teacher will review this withdrawal request.");

  return (
    <article className={cn("rounded-xl border border-[#E1E8EC] bg-white p-3", request.status === "approved" && "border-[#CFE8D6] bg-[#FBFEFC]", request.status === "rejected" && "border-[#F2D5CF] bg-[#FFFDFC]")}>
      <div className="flex items-start gap-3">
        <DefaultProfileIcon />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-5 text-[#26323A]">{request.program?.title ?? "Withdrawal request"}</h3>
              <p className="mt-0.5 text-xs text-[#6B747B]">
                {studentName ? `${studentName} • ` : ""}
                {statusLabel} • {timeAgo(statusTime)}
              </p>
            </div>
            {onDismiss ? (
              <button type="button" onClick={onDismiss} className="-mr-1 -mt-1 p-1 text-[#C83F31] transition-colors hover:text-[#9D2E23]" aria-label="Clear notification">
                <XIcon />
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-5 text-[#26323A]">{message}</p>
          {request.reason ? <p className="mt-2 text-xs leading-5 text-[#6B747B]">Reason: {request.reason}</p> : null}
        </div>
      </div>
    </article>
  );
}

function hasIncompletePaidApproval(request: RequestWithContext) {
  return request.status === "approved" && Boolean(request.program?.is_paid) && !request.payment_bypassed;
}

function ProtectedPaidApplicationClearModal({
  count,
  mode,
  onCancel,
  onConfirm,
}: {
  count: number;
  mode: "single" | "all";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-[#26323A] shadow-[0_24px_60px_rgba(38,50,58,0.22)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF3D6] text-[#9A6400]">
          <span className="text-2xl font-semibold">!</span>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Uncompleted registration</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          {mode === "all" && count > 1
            ? `${count} approved paid applications still need checkout.`
            : "This approved paid application still needs checkout."} Clearing the message removes the checkout entry from your inbox, so you will not be able to complete it from here.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-[6px] bg-[#17624F] px-4 text-sm font-semibold text-white">
            Keep message
          </button>
          <button type="button" onClick={onConfirm} className="min-h-11 rounded-[6px] px-4 text-sm font-semibold text-[#A34B16]">
            Clear anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentResultModal({ status, slug, onClose }: { status: "success" | "cancelled"; slug: string; onClose: () => void }) {
  const isSuccess = status === "success";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-[0_24px_60px_rgba(38,50,58,0.22)]">
        <div
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-full",
            isSuccess ? "bg-[#EAF8EF] text-[#2E6E52]" : "bg-[#FCE8E4] text-[#C83F31]",
          )}
        >
          {isSuccess ? <CheckIcon /> : <XIcon />}
        </div>
        <h2 className="mt-4 text-xl font-semibold text-[#26323A]">{isSuccess ? "Registration complete" : "Payment cancelled"}</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          {isSuccess ? "Your payment went through. Your class should now appear in Classes." : "No payment was completed. You can return here when you are ready."}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {isSuccess ? (
            <TransitionLink href={`/m/${slug}/portal/classes`} label="Classes" className="inline-flex min-h-11 items-center justify-center rounded-[6px] bg-[#2E6E52] px-4 text-sm font-semibold !text-white no-underline">
              Go to Classes
            </TransitionLink>
          ) : null}
          <button type="button" onClick={onClose} className="min-h-11 rounded-[6px] px-4 text-sm font-semibold text-[#6B747B]">
            {isSuccess ? "Stay in inbox" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentConfirmingModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-[0_24px_60px_rgba(38,50,58,0.22)]">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#E7F3F8] border-t-[#2F8FB3]" />
        <h2 className="mt-4 text-xl font-semibold text-[#26323A]">Finishing registration</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">Payment succeeded. We are adding the class to your account.</p>
      </div>
    </div>
  );
}

function studentRequestStatusLabel(request: RequestWithContext) {
  if (request.status === "cancelled" && request.reviewed_by) {
    return "Removed";
  }

  return request.status.charAt(0).toUpperCase() + request.status.slice(1);
}

function DefaultProfileIcon({ className = "h-6 w-6", compact = false }: { className?: string; compact?: boolean } = {}) {
  const icon = (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c1-3.2 3.2-5 6.5-5s5.5 1.8 6.5 5" />
    </svg>
  );

  if (compact) {
    return icon;
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF6F7] text-[#2F8FB3]" aria-hidden>
      {icon}
    </span>
  );
}

function IconActionButton({
  label,
  tone,
  onClick,
  disabled = false,
}: {
  label: string;
  tone: "success" | "danger" | "info";
  onClick: () => void;
  disabled?: boolean;
}) {
  const className =
    tone === "success"
      ? "border-[#2E6E52] bg-[#2E6E52] text-white shadow-[0_6px_14px_rgba(46,110,82,0.18)] hover:bg-[#265D45]"
      : tone === "danger"
        ? "border-[#C83F31] bg-[#C83F31] text-white shadow-[0_6px_14px_rgba(200,63,49,0.18)] hover:bg-[#B6372C]"
        : "border-[#BFDDEC] bg-[#E7F3F8] text-[#257B9C] hover:bg-[#DDEEF6]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("inline-flex min-h-9 items-center justify-center rounded-[5px] border px-3 text-xs font-semibold transition-colors disabled:opacity-60", className)}>
      {label}
    </button>
  );
}

function TeacherAnnouncementBubble({ announcement, readers = [], showSeenDetails = false }: { announcement: AnnouncementWithContext; readers?: Profile[]; showSeenDetails?: boolean }) {
  const authorName = announcement.author?.full_name?.trim() || "You";
  const [readersOpen, setReadersOpen] = useState(false);

  return (
    <article className="flex gap-3">
      <Avatar src={announcement.author?.avatar_url ?? null} name={authorName} />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[#E1E8EC] bg-white p-3 shadow-[0_6px_18px_rgba(38,50,58,0.05)]">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-[#26323A]">{authorName}</h3>
          <span className="text-xs text-[#6B747B]">{timeAgo(announcement.created_at)}</span>
        </div>
        <p className="mt-1 text-xs font-medium text-[#2F8FB3]">{announcement.program?.title ?? "Class announcement"}</p>
        <p className="mt-2 text-sm leading-6 text-[#26323A]">{announcement.message}</p>
        {showSeenDetails ? (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[#6B747B]">
            <span>Seen by {readers.length}</span>
          </div>
        ) : null}
        {showSeenDetails && readersOpen ? (
          <div className="mt-2 rounded-xl bg-[#F7FAFB] px-3 py-2 text-xs text-[#52616A]">
            {readers.map((reader) => reader.full_name || reader.email || "Reader").join(", ")}
          </div>
        ) : null}
      </div>
      {showSeenDetails && readers.length ? (
        <button
          type="button"
          onClick={() => setReadersOpen((value) => !value)}
          className={cn("mt-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF6F7] text-[#2F8FB3] transition hover:bg-[#DCEFF4]", readersOpen && "bg-[#DCEFF4]")}
          aria-label="Show announcement readers"
        >
          <DefaultProfileIcon className="h-4 w-4" compact />
        </button>
      ) : null}
    </article>
  );
}

function InstructorLifecycleNotificationCard({ notification, slug }: { notification: InstructorLifecycleNotification; slug: string }) {
  const instructorName = notification.instructor?.full_name?.trim() || notification.instructor?.email || "Instructor";
  const programTitle = notification.program?.title ?? "this class";
  const actionText = notification.event_type === "resigned" ? "has resigned from" : "has become an instructor of";

  return (
    <article className="rounded-[22px] border border-[#E1E8EC] bg-white p-4 shadow-[0_10px_24px_rgba(38,50,58,0.07)]">
      <div className="flex items-start gap-3">
        <Avatar src={notification.instructor?.avatar_url ?? null} name={instructorName} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-[#26323A]">
            <span className="font-semibold">{instructorName}</span> {actionText} <span className="font-semibold">{programTitle}</span>.
          </p>
          <div className="mt-3">
            <TransitionLink
              href={`/m/${slug}/teacher/classes/${notification.program_id}/instructors`}
              label="Manage"
              className="inline-flex min-h-8 items-center justify-center rounded-full border border-[#D6E1E6] bg-white px-3 text-xs font-semibold text-[#26323A] shadow-[0_6px_14px_rgba(38,50,58,0.08)] transition-colors hover:border-[#B8CBD4] hover:bg-[#F7FAFB]"
            >
              Manage
            </TransitionLink>
          </div>
        </div>
      </div>
    </article>
  );
}

function TeacherRequestCard({
  request,
  reviewed = false,
  onAccept,
  onWaitlist,
  onReject,
  onClear,
}: {
  request: RequestWithContext;
  reviewed?: boolean;
  onAccept?: () => void;
  onWaitlist?: () => void;
  onReject?: () => void;
  onClear?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const studentName = request.student?.full_name ?? "Student";
  const isParentRequest = Boolean(request.parent_profile_id);
  const statusLabel = request.admission_completed_at ? "Admitted" : request.status.charAt(0).toUpperCase() + request.status.slice(1);
  const requestContext = request.admission_completed_at ? "Registration complete" : isParentRequest ? "Parent request" : "Student request";

  return (
    <article className="relative pb-1">
      {!expanded ? <div className="absolute inset-x-8 bottom-0 h-3 rounded-b-[18px] bg-[#DDE7EC]" aria-hidden /> : null}
      <div className="relative overflow-hidden rounded-[22px] border border-[#E1E8EC] bg-white shadow-[0_10px_24px_rgba(38,50,58,0.07)]">
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF6F7] text-[#2F8FB3]" aria-hidden>
            <DefaultProfileIcon className="h-5 w-5" compact />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{studentName}</h3>
            <p className="mt-0.5 truncate text-xs leading-4 text-[#6B747B]">
              {requestContext} • {request.program?.title ?? "Class request"}
            </p>
          </div>
          {reviewed ? (
            <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", request.admission_completed_at || request.status === "approved" ? "bg-[#EAF8EF] text-[#258A43]" : request.status === "waitlisted" ? "bg-[#FFF4D6] text-[#8A6418]" : "bg-[#FDEDEA] text-[#C83F31]")}>
              {statusLabel}
            </span>
          ) : null}
          {reviewed && onClear ? (
            <button type="button" onClick={onClear} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#7B858C] transition-colors hover:bg-[#FCEDEC] hover:text-[#C83F31]" aria-label="Clear request">
              <XIcon />
            </button>
          ) : null}
          <button type="button" onClick={() => setExpanded((value) => !value)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E7F3F8] text-[#257B9C] transition-colors hover:bg-[#DDEEF6]" aria-label={expanded ? "Hide student details" : "Show student details"}>
            <ChevronIcon expanded={expanded} />
          </button>
        </div>
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="border-t border-[#E6ECEF] bg-[#F8FAFB] px-5 py-4">
              <dl className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)] gap-x-5 gap-y-3 text-sm">
                {request.admission_completed_at ? <RequestDetail label="Admitted" value={timeAgo(request.admission_completed_at)} /> : null}
                {isParentRequest ? (
                  <>
                    <RequestDetail label="Child" value={request.student?.full_name} />
                    <RequestDetail label="Child Age" value={displayAge(request.student)} />
                    <RequestDetail label="Gender" value={request.student?.gender} />
                    <RequestDetail label="Parent" value={request.parent?.full_name} />
                    <RequestDetail label="Parent Email" value={request.parent?.email} />
                    <RequestDetail label="Parent Phone" value={request.parent?.phone_number} />
                  </>
                ) : (
                  <>
                    <RequestDetail label="Email" value={request.student?.email} />
                    <RequestDetail label="Phone" value={request.student?.phone_number} />
                    <RequestDetail label="Age" value={displayAge(request.student)} />
                    <RequestDetail label="Gender" value={request.student?.gender} />
                  </>
                )}
              </dl>
              {!reviewed ? (
                <div className={cn("mt-4 grid gap-2", onWaitlist ? "grid-cols-3" : "grid-cols-2")}>
                  <button type="button" onClick={onAccept} className="min-h-10 rounded-[9px] bg-[#E2F6E8] px-2 text-xs font-semibold text-[#258A43] transition-colors hover:bg-[#D4F0DD]">
                    Accept
                  </button>
                  {onWaitlist ? (
                    <button type="button" onClick={onWaitlist} className="min-h-10 rounded-[9px] bg-[#FFF4D6] px-2 text-xs font-semibold text-[#8A6418] transition-colors hover:bg-[#FFE9A8]">
                      Waitlist
                    </button>
                  ) : null}
                  <button type="button" onClick={onReject} className="min-h-10 rounded-[9px] bg-[#FCE8E4] px-2 text-xs font-semibold text-[#C83F31] transition-colors hover:bg-[#F9D8D1]">
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function WithdrawalRequestCard({
  request,
  reviewed = false,
  busy = false,
  onApprove,
  onReject,
}: {
  request: WithdrawalRequestWithContext;
  reviewed?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const studentName = request.student?.full_name?.trim() || "Student";
  const programTitle = request.program?.title ?? "Class";
  const requester = request.parent?.full_name?.trim() || (request.requested_by === request.student_profile_id ? studentName : "Family");
  const subscription = request.subscription;
  const hasStripeSubscription = Boolean(subscription?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(subscription.status));
  const statusText = request.status === "pending" ? "Pending review" : titleCase(request.status);

  return (
    <article className="rounded-[22px] border border-[#E1E8EC] bg-white p-4 shadow-[0_10px_24px_rgba(38,50,58,0.06)]">
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-start gap-3 text-left">
        <Avatar src={request.student?.avatar_url ?? null} name={studentName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{studentName}</h3>
              <p className="mt-0.5 truncate text-xs text-[#6B747B]">{programTitle} · {timeAgo(request.requested_at)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", request.status === "pending" ? "bg-[#FFF7E6] text-[#996800]" : "bg-[#EEF3F5] text-[#52616A]")}>{statusText}</span>
              <ChevronIcon expanded={expanded} />
            </div>
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="mt-4 border-t border-[#E3E8EC] pt-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Requested by</dt>
            <dd className="truncate text-[#26323A]">{requester}</dd>
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Student</dt>
            <dd className="truncate text-[#26323A]">{studentName}</dd>
            {request.parent ? (
              <>
                <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Parent</dt>
                <dd className="truncate text-[#26323A]">{request.parent.full_name ?? "Parent"}{request.parent.email ? ` · ${request.parent.email}` : ""}</dd>
              </>
            ) : null}
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Reason</dt>
            <dd className="whitespace-pre-wrap text-[#26323A]">{request.reason?.trim() || "No reason provided."}</dd>
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">No refund</dt>
            <dd className="text-[#26323A]">{request.understands_no_refund ? "Acknowledged" : "Not acknowledged"}</dd>
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Immediate exit</dt>
            <dd className="text-[#26323A]">{request.understands_immediate_exit ? "Acknowledged" : "Not acknowledged"}</dd>
            <dt className="font-semibold uppercase tracking-wide text-[#8A949B]">Billing</dt>
            <dd className="text-[#26323A]">
              {hasStripeSubscription
                ? "Active Stripe subscription. Accepting cancels it immediately."
                : subscription?.cancel_at_period_end
                  ? "Stripe cancellation already scheduled."
                  : subscription
                    ? `Subscription status: ${subscription.status}`
                    : "No paid subscription found."}
            </dd>
          </dl>
          {hasStripeSubscription ? (
            <p className="mt-3 rounded-[14px] bg-[#FFF8E8] px-3 py-2 text-xs font-semibold leading-5 text-[#9A6400]">
              Accepting this request ends class access and cancels the subscription immediately.
            </p>
          ) : request.status === "pending" ? (
            <p className="mt-3 rounded-[14px] bg-[#F4FBF8] px-3 py-2 text-xs font-semibold leading-5 text-[#17624F]">
              Accepting this request removes the student from the class immediately.
            </p>
          ) : null}
          {reviewed && request.decision_note ? <p className="mt-2 text-sm leading-5 text-[#6B747B]">{request.decision_note}</p> : null}
          {!reviewed && request.status === "pending" ? (
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="min-h-10 rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white disabled:bg-[#D8E2E5] disabled:text-[#8A949B]"
              >
                {busy ? "Working..." : "Accept withdrawal and remove student"}
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                className="min-h-10 rounded-full bg-[#EEF3F5] px-4 text-sm font-semibold text-[#26323A] disabled:opacity-60"
              >
                Reject withdrawal and keep student
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ApplicationDecisionModal({
  target,
  busy = false,
  onClose,
  onSubmit,
}: {
  target: { request: RequestWithContext; action: "approved" | "waitlisted" | "rejected" };
  busy?: boolean;
  onClose: () => void;
  onSubmit: (options: { priceMonthlyCents?: number | null; paymentBypassed?: boolean; note?: string | null }) => void;
}) {
  const defaultPrice = ((target.request.approved_price_monthly_cents ?? target.request.program?.price_monthly_cents ?? 0) / 100).toFixed(2).replace(/\.00$/, "");
  const [price, setPrice] = useState(defaultPrice === "0" ? "" : defaultPrice);
  const [bypassPayment, setBypassPayment] = useState(false);
  const [billingMode, setBillingMode] = useState<"monthly" | "one_time">("monthly");
  const [note, setNote] = useState("");
  const studentName = target.request.student?.full_name?.trim() || "this student";
  const title = target.action === "approved" ? "Accept application" : target.action === "waitlisted" ? "Waitlist application" : "Reject application";
  const defaultNote =
    target.action === "waitlisted"
      ? "You have been waitlisted. We will notify you once a spot becomes available."
      : target.action === "rejected"
        ? "Your application was not accepted at this time."
        : bypassPayment
          ? "Your application was accepted and you have been admitted. Payment By-passed."
          : "Your application was accepted. Complete checkout to activate enrollment.";

  function submit() {
    const numericPrice = Math.max(0, Math.round(Number(price || "0") * 100));
    onSubmit({
      paymentBypassed: target.action === "approved" ? bypassPayment : false,
      priceMonthlyCents: target.action === "approved" && !bypassPayment ? numericPrice : null,
      note: note.trim() || defaultNote,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">{target.request.program?.title ?? "Class application"}</p>
        <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">{studentName}</p>

        {target.action === "approved" ? (
          <div className="mt-5 space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#26323A]">
              <input type="checkbox" checked={bypassPayment} onChange={(event) => setBypassPayment(event.target.checked)} />
              Bypass payment process
            </label>
            {!bypassPayment ? (
              <>
                <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-[#D6DCE0]">
                  {(["monthly", "one_time"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBillingMode(mode)}
                      className={cn("min-h-10 text-sm font-semibold", billingMode === mode ? "bg-[#17624F] text-white" : "bg-white text-[#52616A]")}
                    >
                      {mode === "monthly" ? "Monthly" : "One-time"}
                    </button>
                  ))}
                </div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">{billingMode === "monthly" ? "Monthly price" : "One-time fee"}</span>
                  <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="mt-1 h-11 w-full rounded-[10px] border border-[#B9C3C8] px-3 text-sm font-semibold outline-none focus:border-[#2F8FB3]" />
                </label>
                {billingMode === "one_time" ? <p className="text-xs leading-5 text-[#7B858C]">UI only for now: one-time checkout generation still needs the billing workflow wired.</p> : null}
              </>
            ) : null}
          </div>
        ) : null}

        <label className="mt-5 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Message</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={defaultNote}
            className="mt-1 min-h-28 w-full resize-none rounded-[14px] border border-[#B9C3C8] px-3 py-2 text-sm leading-6 outline-none focus:border-[#2F8FB3]"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-10 px-3 text-sm font-semibold text-[#6B747B] disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy} className="min-h-10 rounded-[10px] bg-[#17624F] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Working..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeacherMetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-[#E1E8EC] bg-white p-4 shadow-[0_10px_26px_rgba(38,50,58,0.06)]">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EAF5F7] text-[#2F8FB3]">{icon}</div>
      <p className="mt-4 text-3xl font-semibold leading-none text-[#26323A]">{value}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#6B747B]">{label}</p>
    </div>
  );
}

type TeacherStudentItem = { enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null; trackIds?: string[] };

function studentRoleLabel(item: TeacherStudentItem) {
  if (item.parent) {
    return "Child";
  }

  if (item.profile?.account_type === "parent") {
    return "Parent";
  }

  return "Adult Student";
}

function TeacherStudentListControls({
  search,
  gender,
  sort,
  sortDirection,
  view,
  tracks,
  selectedTrackIds,
  onSearchChange,
  onGenderChange,
  onTrackToggle,
  onSortChange,
  onSortDirectionChange,
  onViewChange,
}: {
  search: string;
  gender: string;
  sort: "first" | "last" | "age";
  sortDirection: "asc" | "desc";
  view: "students" | "parents";
  tracks: ProgramTrack[];
  selectedTrackIds: string[];
  onSearchChange: (value: string) => void;
  onGenderChange: (value: string) => void;
  onTrackToggle: (trackId: string) => void;
  onSortChange: (value: "first" | "last" | "age") => void;
  onSortDirectionChange: (value: "asc" | "desc") => void;
  onViewChange: (value: "students" | "parents") => void;
}) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [trackMenuOpen, setTrackMenuOpen] = useState(false);
  const allTracksSelected = tracks.length > 0 && selectedTrackIds.length === tracks.length;
  const trackLabel = tracks.length === 0 || allTracksSelected ? "All tracks" : selectedTrackIds.length === 0 ? "No tracks" : selectedTrackIds.length === 1 ? tracks.find((track) => track.id === selectedTrackIds[0])?.name ?? "1 track" : `${selectedTrackIds.length} tracks`;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="sr-only">Search students</span>
        <span className="flex h-11 items-center gap-2 rounded-full bg-[#F5F7F8] px-4 text-[#7B858C]">
          <SearchIcon />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#26323A] outline-none placeholder:text-[#9AA4AA]"
          />
        </span>
      </label>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {(["all", "male", "female"] as const).map((value) => {
            const label = value === "all" ? "All" : value === "male" ? "Brothers" : "Sisters";
            const active = gender === value;
            return (
              <button
                key={value}
                type="button"
                disabled={view === "parents" && value !== "all"}
                onClick={() => onGenderChange(value)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  active ? "bg-[#5DAF93] text-white" : "bg-[#F2F4F5] text-[#6B747B]",
                  view === "parents" && value !== "all" && "hidden",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setViewMenuOpen((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#26323A] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_14px_rgba(38,50,58,0.14)]"
            aria-expanded={viewMenuOpen}
          >
            <span>{view === "students" ? "Students" : "Parents"}</span>
            <ChevronIcon expanded={viewMenuOpen} />
          </button>
          {viewMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-32 rounded-[16px] border border-[#DDE5E9] bg-white p-1 shadow-[0_18px_44px_rgba(38,50,58,0.18)]">
              {(["students", "parents"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    onViewChange(value);
                    setViewMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center rounded-[12px] px-3 py-2 text-left text-sm font-semibold",
                    view === value ? "bg-[#F2F6F7] text-[#26323A]" : "text-[#6B747B] hover:bg-[#F7FAFB]",
                  )}
                >
                  {value === "students" ? "Students" : "Parents"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {tracks.length ? (
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setTrackMenuOpen((value) => !value)}
              className="flex h-10 w-full items-center justify-between gap-2 rounded-full border border-[#DDE5E9] bg-white px-3 text-left text-sm font-semibold text-[#26323A] outline-none"
              aria-expanded={trackMenuOpen}
            >
              <span className="min-w-0 truncate">{trackLabel}</span>
              <ChevronIcon expanded={trackMenuOpen} />
            </button>
            {trackMenuOpen ? (
              <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-56 rounded-[16px] border border-[#DDE5E9] bg-white p-2 shadow-[0_18px_44px_rgba(38,50,58,0.18)]">
                <div className="grid grid-cols-2 gap-1.5 border-b border-[#EEF2F4] pb-2">
                  <button
                    type="button"
                    onClick={() => onTrackToggle("select_all")}
                    className="min-h-8 rounded-[10px] bg-[#EAF7F1] px-2 text-xs font-semibold text-[#17624F] transition-colors hover:bg-[#DDF1E7]"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => onTrackToggle("deselect_all")}
                    className="min-h-8 rounded-[10px] bg-[#F2F4F5] px-2 text-xs font-semibold text-[#52616A] transition-colors hover:bg-[#E8ECEF]"
                  >
                    Deselect all
                  </button>
                </div>
                <div className="pt-1">
                {tracks.map((track) => (
                  <RosterTrackOption key={track.id} checked={selectedTrackIds.includes(track.id)} label={track.name} onClick={() => onTrackToggle(track.id)} />
                ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Sort students</span>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as "first" | "last" | "age")}
            className="h-10 w-full rounded-full border border-[#DDE5E9] bg-white px-3 text-sm font-semibold text-[#26323A] outline-none"
          >
            <option value="first">First name</option>
            <option value="last">Last name</option>
            <option value="age">Age</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#DDE5E9] bg-white text-[#26323A]"
          aria-label={sortDirection === "asc" ? "Sort descending" : "Sort ascending"}
        >
          <SortDirectionIcon direction={sortDirection} />
        </button>
      </div>
    </div>
  );
}

function StudentActionMenu({ busy, onNote, onKick }: { busy: boolean; onNote: () => void; onKick: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((value) => !value);
        }}
        className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors", menuOpen ? "bg-[#26323A] text-white" : "text-[#52616A] hover:bg-[#EEF3F5] hover:text-[#26323A]")}
        aria-label="Student actions"
      >
        <MoreVerticalIcon />
      </button>
      {menuOpen ? (
        <span className="absolute right-0 top-11 z-30 w-40 overflow-hidden rounded-[16px] border border-[#DDE5E9] bg-white p-1 text-sm shadow-[0_18px_44px_rgba(38,50,58,0.18)]">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onNote();
            }}
            className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left font-semibold text-[#26323A] hover:bg-[#F4F8F9]"
          >
            Add note
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (busy) {
                return;
              }
              setMenuOpen(false);
              onKick();
            }}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left font-semibold text-[#C83F31] hover:bg-[#FFF1EF] disabled:opacity-50"
          >
            {busy ? "Removing..." : "Remove"}
          </button>
        </span>
      ) : null}
    </span>
  );
}

function TeacherStudentRow({
  item,
  busy,
  onKick,
  onNote,
}: {
  item: TeacherStudentItem;
  busy: boolean;
  onKick: () => void;
  onNote: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const studentName = item.profile?.full_name ?? "Student";
  const roleLabel = studentRoleLabel(item);

  return (
    <article>
      <div className="flex items-center gap-3 py-3">
        <Avatar src={item.profile?.avatar_url ?? null} name={studentName} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{studentName}</h3>
          <p className="mt-0.5 truncate text-xs font-medium text-[#7B858C]">{roleLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52616A] hover:bg-[#EEF3F5]"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide student details" : "Show student details"}
        >
          <ChevronIcon expanded={expanded} />
        </button>
        <StudentActionMenu busy={busy} onNote={onNote} onKick={onKick} />
      </div>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="pb-4 pl-0 pr-2">
            <dl className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)] gap-x-4 gap-y-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3 text-sm">
              {item.parent ? null : <RequestDetail label="Email" value={item.profile?.email} singleLine />}
              <RequestDetail label="Age" value={displayAge(item.profile)} />
              {item.parent ? null : <RequestDetail label="Phone" value={item.profile?.phone_number} singleLine />}
              <RequestDetail label="Gender" value={formatStudentDetailGender(item.profile?.gender ?? null)} />
              {item.parent ? (
                <>
                  <RequestDetail label="Parent" value={item.parent.full_name} singleLine />
                  <RequestDetail label="Parent Phone" value={item.parent.phone_number} singleLine />
                  <RequestDetail label="Parent Email" value={item.parent.email} singleLine />
                </>
              ) : null}
            </dl>
          </div>
        </div>
      </div>
    </article>
  );
}

function TeacherFamilyRow({
  group,
  busyStudentId,
  onKick,
  onNote,
}: {
  group: { parent: ParentDisplay | null; children: TeacherStudentItem[] };
  busyStudentId: string | null;
  onKick: (student: TeacherStudentItem) => void;
  onNote: (student: TeacherStudentItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const parentName = group.parent?.full_name?.trim() || group.children[0]?.profile?.full_name?.trim() || "No parent profile";
  const childCount = group.children.length;

  return (
    <article>
      <div className="flex items-center gap-3 py-3">
        <Avatar src={group.parent?.avatar_url ?? group.children[0]?.profile?.avatar_url ?? null} name={parentName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-5 text-[#26323A]">{parentName}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[#7B858C]">Parent</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52616A] hover:bg-[#EEF3F5]"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide parent details" : "Show parent details"}
        >
          <ChevronIcon expanded={expanded} />
        </button>
      </div>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="space-y-3 pb-4 pl-0 pr-2">
            <dl className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)] gap-x-4 gap-y-3 rounded-[18px] bg-[#F7FAFB] px-4 py-3 text-sm">
              <RequestDetail label="Parent" value={group.parent?.full_name} singleLine />
              <RequestDetail label="Phone" value={group.parent?.phone_number} singleLine />
              <RequestDetail label="Email" value={group.parent?.email} singleLine />
            </dl>
            <div className="divide-y divide-[#EEF2F4] rounded-[18px] bg-[#FCFDFD] px-3">
              {group.children.map((student) => (
                <div key={student.enrollment.id} className="relative flex items-center gap-3 py-3">
                  <Avatar src={student.profile?.avatar_url ?? null} name={student.profile?.full_name ?? "Student"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#26323A]">{student.profile?.full_name ?? "Student"}</p>
                    <p className="mt-0.5 truncate text-xs text-[#7B858C]">Child</p>
                  </div>
                  <StudentActionMenu
                    busy={busyStudentId === student.enrollment.student_profile_id}
                    onNote={() => onNote(student)}
                    onKick={() => onKick(student)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function StudentInboxThreadList({
  threads,
  emptyText,
}: {
  threads: Array<{ id: string; title: string; subtitle: string; meta: string; unreadCount: number; onClick: () => void }>;
  emptyText: string;
}) {
  if (!threads.length) {
    return (
      <div className="rounded-[18px] bg-[#F7FAFB] px-4 py-6 text-center text-sm font-medium leading-6 text-[#6B747B]">
        {emptyText}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_12px_28px_rgba(38,50,58,0.07)] ring-1 ring-[#E4EAEE]">
      <div className="divide-y divide-[#EEF2F4]">
        {threads.map((thread) => {
          const unread = thread.unreadCount > 0;
          return (
            <button key={thread.id} type="button" onClick={thread.onClick} className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#F7FAFB]">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", unread ? "bg-[#2F8FB3]" : "bg-transparent")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[15px] leading-5", unread ? "font-semibold text-[#26323A]" : "font-medium text-[#52616A]")}>{thread.title}</span>
                <span className="mt-1 block truncate text-sm text-[#6B747B]">{thread.subtitle}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs text-[#8A949B]">{thread.meta}</span>
                {unread ? <span className="mt-1 inline-flex rounded-full bg-[#E7F3F8] px-2 py-0.5 text-xs font-semibold text-[#2F8FB3]">{thread.unreadCount}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StudentInboxThreadView({
  thread,
  announcements,
  notes,
  hasOlderAnnouncements = false,
  loadingOlderAnnouncements = false,
  onLoadOlderAnnouncements,
  hasOlderNotes = false,
  loadingOlderNotes = false,
  onLoadOlderNotes,
  onBack,
}: {
  thread: StudentInboxThread;
  announcements: AnnouncementWithContext[];
  notes: StudentNoteWithContext[];
  hasOlderAnnouncements?: boolean;
  loadingOlderAnnouncements?: boolean;
  onLoadOlderAnnouncements?: () => void;
  hasOlderNotes?: boolean;
  loadingOlderNotes?: boolean;
  onLoadOlderNotes?: () => void;
  onBack: () => void;
}) {
  const threadAnnouncements = thread.kind === "announcements"
    ? announcements
        .filter((announcement) => announcement.program_id === thread.programId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    : [];
  const threadNotes = thread.kind === "notes"
    ? notes
        .filter((note) => note.program_id === thread.programId && note.student_profile_id === thread.studentId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    : [];
  const title = thread.kind === "announcements"
    ? threadAnnouncements[0]?.program?.title ?? "Announcements"
    : threadNotes[0]?.program?.title ?? "Notes";
  const subtitle = thread.kind === "notes" ? `For ${threadNotes[0]?.student?.full_name ?? "student"}` : "Class announcements";

  return (
    <section className="overflow-hidden rounded-[24px] bg-[#F7FAFB] shadow-[0_12px_28px_rgba(38,50,58,0.07)] ring-1 ring-[#E4EAEE]">
      <div className="flex items-center gap-3 border-b border-[#E1E8EC] bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF3F5] text-[#26323A]" aria-label="Back to inbox">
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[#26323A]">{title}</h2>
          <p className="truncate text-sm text-[#6B747B]">{subtitle}</p>
        </div>
      </div>
      <div className="max-h-[520px] space-y-3 overflow-y-auto p-4">
        {thread.kind === "announcements" ? (
          threadAnnouncements.length ? (
            <>
              {threadAnnouncements.map((announcement) => <StudentAnnouncementCard key={announcement.id} announcement={announcement} />)}
              {hasOlderAnnouncements ? (
                <button
                  type="button"
                  onClick={onLoadOlderAnnouncements}
                  disabled={loadingOlderAnnouncements}
                  className="mx-auto flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#2F8FB3] shadow-[0_6px_18px_rgba(38,50,58,0.06)] ring-1 ring-[#DDE7EC] transition-colors hover:bg-[#F5FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingOlderAnnouncements ? "Loading older..." : "Load older"}
                </button>
              ) : null}
            </>
          ) : (
            <MiniEmpty text="No announcements in this thread." />
          )
        ) : threadNotes.length ? (
          <>
            {threadNotes.map((note) => <StudentNoteBubble key={note.id} note={note} viewer="recipient" />)}
            {hasOlderNotes ? (
              <button
                type="button"
                onClick={onLoadOlderNotes}
                disabled={loadingOlderNotes}
                className="mx-auto flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#2F8FB3] shadow-[0_6px_18px_rgba(38,50,58,0.06)] ring-1 ring-[#DDE7EC] transition-colors hover:bg-[#F5FAFC] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingOlderNotes ? "Loading older..." : "Load older"}
              </button>
            ) : null}
          </>
        ) : (
          <MiniEmpty text="No notes in this thread." />
        )}
      </div>
    </section>
  );
}

function ChildNoteRecipientPrompt({
  studentName,
  parentName,
  onClose,
  onGoToParent,
}: {
  studentName: string;
  parentName: string;
  onClose: () => void;
  onGoToParent: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
        <h2 className="text-xl font-semibold">Message parent</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          {studentName} is a child profile. Notes for this student should be sent to {parentName || "their parent"}.
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-2 py-2 text-sm font-semibold text-[#6B747B]">
            Cancel
          </button>
          <button type="button" onClick={onGoToParent} className="rounded-full bg-[#17624F] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F4537]">
            Go to parent
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeacherStudentNotesData({ slug, programId, studentId }: { slug: string; programId: string; studentId: string }) {
  const [mosque, setMosque] = useState<Mosque | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [target, setTarget] = useState<TeacherStudentItem | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;

      const { data: mosqueData, error: mosqueError } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();
      if (cancelled) {
        return;
      }
      if (mosqueError || !mosqueData) {
        setError(mosqueError?.message ?? "Masjid not found.");
        setLoading(false);
        return;
      }

      const { data: programData, error: programError } = await supabase
        .from("programs")
        .select("*")
        .eq("id", programId)
        .eq("mosque_id", mosqueData.id)
        .maybeSingle();
      if (cancelled) {
        return;
      }
      if (programError || !programData) {
        setError(programError?.message ?? "Class not found.");
        setLoading(false);
        return;
      }

      const { data: enrollment, error: enrollmentError } = await supabase
        .from("enrollments")
        .select("*")
        .eq("program_id", programData.id)
        .eq("student_profile_id", studentId)
        .maybeSingle();
      if (cancelled) {
        return;
      }
      if (enrollmentError || !enrollment) {
        setError(enrollmentError?.message ?? "Student enrollment not found.");
        setLoading(false);
        return;
      }

      const [{ data: profile }, { data: link }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type")
          .eq("id", studentId)
          .maybeSingle(),
        supabase
          .from("parent_child_links")
          .select("child_profile_id, parent_profile_id")
          .eq("mosque_id", mosqueData.id)
          .eq("child_profile_id", studentId)
          .maybeSingle(),
      ]);
      const { data: parent } = link?.parent_profile_id
        ? await supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url").eq("id", link.parent_profile_id).maybeSingle()
        : { data: null as ParentDisplay | null };

      if (!cancelled) {
        setMosque(mosqueData);
        setProgram(programData);
        setTarget({
          enrollment,
          profile: (profile as StudentDisplay | null) ?? null,
          parent: (parent as ParentDisplay | null) ?? null,
        });
        setCurrentUserId(userId);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [programId, slug, studentId]);

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error) {
    return <EmptyState title="Could not load notes" text={error} />;
  }

  if (!program || !target) {
    return <EmptyState title="Student not found" text="This student could not be loaded for notes." />;
  }

  return <TeacherStudentNotesPage mosque={mosque} program={program} target={target} currentUserId={currentUserId} />;
}

function TeacherStudentNotesPage({
  mosque,
  program,
  target,
  currentUserId,
}: {
  mosque: Mosque | null;
  program: Program;
  target: { enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null };
  currentUserId: string | null;
}) {
  const [notes, setNotes] = useState<StudentNoteWithContext[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studentName = target.profile?.full_name?.trim() || "Student";
  const recipient = target.parent ?? target.profile;
  const recipientName = recipient?.full_name?.trim() || (target.parent ? "Parent" : studentName);
  const recipientKind = target.parent ? "Parent" : "Student";
  const recipientAvatar = target.parent?.avatar_url ?? target.profile?.avatar_url ?? null;

  async function loadNotes() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data: noteRows, error: noteError } = await supabase
      .from("program_student_notes")
      .select("*")
      .eq("program_id", program.id)
      .eq("student_profile_id", target.enrollment.student_profile_id)
      .order("created_at", { ascending: true });

    if (noteError) {
      setError(noteError.message);
      setLoading(false);
      return;
    }

    const authorIds = Array.from(new Set((noteRows ?? []).map((note) => note.author_profile_id)));
    const { data: authors } = authorIds.length ? await supabase.from("profiles").select("*").in("id", authorIds) : { data: [] as Profile[] };
    setNotes(
      (noteRows ?? []).map((note) => ({
        ...note,
        program,
        student: target.profile,
        recipient: recipient as Profile | null,
        author: (authors ?? []).find((author) => author.id === note.author_profile_id) ?? null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadNotes();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id, target.enrollment.student_profile_id]);

  async function sendNote() {
    if (!mosque || !currentUserId || !recipient?.id || !message.trim()) {
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: insertError } = await supabase.from("program_student_notes").insert({
      mosque_id: mosque.id,
      program_id: program.id,
      student_profile_id: target.enrollment.student_profile_id,
      recipient_profile_id: recipient.id,
      parent_profile_id: target.parent?.id ?? null,
      author_profile_id: currentUserId,
      category: "note",
      message: message.trim(),
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMessage("");
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadNotes();
  }

  return (
    <div className="bg-white px-0 pb-28 pt-0 text-[#26323A]">
      <div className="flex min-h-[calc(100vh-230px)] flex-col">
        <section className="border-b border-[#E6ECEF] px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <Avatar src={recipientAvatar} name={recipientName} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#EEF6F7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2F8FB3]">{recipientKind}</span>
                {target.parent ? <span className="truncate text-xs font-semibold text-[#6B747B]">For {studentName}</span> : null}
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold leading-6">{recipientName}</h1>
              <p className="mt-1 truncate text-sm font-semibold text-[#17624F]">{program.title}</p>
              <p className="mt-1 truncate text-xs text-[#7B858C]">
                {[target.profile?.email, target.profile?.phone_number].filter(Boolean).join(" - ") || "No student contact on file"}
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col px-4">
          <div className="min-h-[280px] flex-1 space-y-3 overflow-y-auto py-4">
            {error ? <div className="rounded-xl bg-[#FDEDEA] px-3 py-2 text-sm text-[#A4352A]">{error}</div> : null}
            {loading ? (
              <InboxLoadingPanel label="Loading student notes" />
            ) : notes.length ? (
              notes.map((note) => <StudentNoteBubble key={note.id} note={note} viewer="teacher" />)
            ) : (
              <MiniEmpty text="No notes have been sent for this student in this class." />
            )}
          </div>
          <div className="mt-3 flex items-end gap-2 rounded-[28px] border border-[#D6DCE0] bg-[#F8FAFB] px-3 py-2 shadow-[0_10px_24px_rgba(38,50,58,0.08)]">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a note..."
              rows={1}
              className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-6 text-[#26323A] outline-none placeholder:text-[#9AA4AA]"
            />
            <button
              type="button"
              disabled={busy || !message.trim()}
              onClick={sendNote}
              className={cn(
                "mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                message.trim() && !busy ? "bg-[#2F80ED] text-white" : "bg-[#D6DCE0] text-white",
              )}
              aria-label="Send note"
            >
              <SendUpIcon />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function RequestDetail({ label, value, singleLine = false }: { label: string; value: string | null | undefined; singleLine?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold leading-5 text-[#26323A]", singleLine ? "truncate whitespace-nowrap" : "break-words")}>{value?.trim() || "Not provided"}</dd>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {expanded ? <path d="m7 14 5-5 5 5" /> : <path d="m7 10 5 5 5-5" />}
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 3.5 3.5" />
    </svg>
  );
}

function SendUpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5" />
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
    </svg>
  );
}

function SortDirectionIcon({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {direction === "asc" ? (
        <>
          <path d="M12 19V5" />
          <path d="m6 11 6-6 6 6" />
        </>
      ) : (
        <>
          <path d="M12 5v14" />
          <path d="m6 13 6 6 6-6" />
        </>
      )}
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function StudentsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="7.2" r="3" />
      <circle cx="5.8" cy="9" r="2.3" />
      <circle cx="18.2" cy="9" r="2.3" />
      <path d="M7.3 20c.55-3.1 2.12-4.65 4.7-4.65s4.15 1.55 4.7 4.65" />
      <path d="M2.8 18.4c.38-2.24 1.43-3.36 3.15-3.36.75 0 1.37.21 1.87.64" />
      <path d="M16.18 15.68c.5-.43 1.12-.64 1.87-.64 1.72 0 2.77 1.12 3.15 3.36" />
    </svg>
  );
}

function InstructorManageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6.4 6.8 5.7-2.25 5.7 2.25-5.7 2.25-5.7-2.25Z" />
      <path d="M17.8 6.8v3.35" />
      <circle cx="12" cy="12.2" r="3.05" />
      <path d="M5.9 20.3c.8-3.12 2.84-4.68 6.1-4.68s5.3 1.56 6.1 4.68" />
    </svg>
  );
}

function AttendanceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3-4 3 2 4-6" />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3 11 18-5v12L3 13v-2Z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 15h4" />
      <path d="M8 18h8" />
    </svg>
  );
}

function FinanceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
      <path d="M16.5 14.5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z" />
    </svg>
  );
}

function PermissionClassIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19V7.5L12 4l8 3.5V19" />
      <path d="M8 19v-6h8v6" />
      <path d="M10 9h4" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 4h6v6" />
      <path d="m10 14 10-10" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function EditClassIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PhotoIcon({ className = "h-5 w-5" }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m6.5 17 4.2-4.2a1.4 1.4 0 0 1 2 0L15.5 15l1.2-1.2a1.4 1.4 0 0 1 2 0l1.8 1.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v.75h-9V6A1.5 1.5 0 0 1 9 4.5Z" />
      <path d="M8 6.75H6.5A2.5 2.5 0 0 0 4 9.25v8.25A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V9.25a2.5 2.5 0 0 0-2.5-2.5H16" />
      <path d="M8.5 12.5h7" />
      <path d="M8.5 16h5" />
    </svg>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#E1E8EC] bg-white p-5 shadow-[0_10px_28px_rgba(38,50,58,0.06)] md:p-6">
      <h2 className="text-base font-semibold text-[#26323A]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProgramMediaGallery({ items }: { items: readonly ProgramMedia[] }) {
  const [active, setActive] = useState(0);
  const activeItem = items[active] ?? items[0];

  return (
    <DetailSection title="Program Media">
      <div className="overflow-hidden rounded-xl border border-[#D6DCE0] bg-[var(--workspace)]">
        <div className="relative flex aspect-[16/10] items-end overflow-hidden p-5 text-white">
          <Image src={mediaUrl(activeItem)} alt={mediaAltText(activeItem)} fill className="object-cover" sizes="(min-width: 1024px) 720px, 100vw" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
          {mediaType(activeItem) === "video" ? (
            <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#17624F] shadow-lg" aria-hidden>
              ▶
            </span>
          ) : null}
          <div className="relative">
            <p className="text-xs font-medium uppercase tracking-wide text-white/80">{mediaType(activeItem) === "video" ? "Video" : "Photo"}</p>
            <p className="mt-1 text-lg font-semibold">{mediaTitle(activeItem)}</p>
            {mediaCaption(activeItem) ? <p className="mt-1 max-w-xl text-sm leading-5 text-white/85">{mediaCaption(activeItem)}</p> : null}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 border-t border-[#D6DCE0] bg-white p-2">
          {items.map((item, index) => (
            <button
              key={`${mediaShortLabel(item)}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                "relative aspect-square overflow-hidden border text-left transition",
                active === index ? "border-[#248B72] ring-2 ring-[#B9E4D7]" : "border-[#D6DCE0]",
              )}
              aria-label={`Show ${mediaTitle(item)}`}
            >
              <Image src={mediaThumbnail(item)} alt={mediaAltText(item)} fill className="object-cover" sizes="96px" />
              <span className="absolute inset-0 bg-black/15" />
              <span className="absolute bottom-1 left-1 right-1 truncate text-[10px] font-medium text-white">{mediaShortLabel(item)}</span>
            </button>
          ))}
        </div>
      </div>
    </DetailSection>
  );
}

function contentDescription(row: ProgramContentSection) {
  return row.description ?? "";
}

function contentDuration(row: ProgramContentSection) {
  return row.duration_text ?? "";
}

function mediaUrl(item: ProgramMedia) {
  return item.url;
}

function mediaThumbnail(item: ProgramMedia) {
  return item.thumbnail_url ?? item.url;
}

function mediaTitle(item: ProgramMedia) {
  return item.title ?? "Program media";
}

function mediaCaption(item: ProgramMedia) {
  return item.caption ?? "";
}

function mediaAltText(item: ProgramMedia) {
  return item.alt_text ?? mediaTitle(item);
}

function mediaShortLabel(item: ProgramMedia) {
  return item.short_label ?? mediaTitle(item);
}

function mediaType(item: ProgramMedia) {
  return item.media_type;
}

function SidebarFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[#6B747B]">{label}</dt>
      <dd className="max-w-[60%] text-right font-medium text-[#26323A]">{value}</dd>
    </div>
  );
}

function ProgramFaqSection({ faqs }: { faqs: Array<Pick<ProgramFaq, "id" | "question" | "answer">> }) {
  const [openId, setOpenId] = useState("");
  return (
    <section className="overflow-hidden rounded-[28px] bg-[#F6F1FF] p-4 shadow-[0_14px_36px_rgba(75,52,117,0.10)]">
      <div className="rounded-[24px] bg-white/72 p-4 ring-1 ring-white">
        <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#5D4A86] shadow-sm">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#EEE6FF] text-[#5D4A86]">?</span>
          Frequently Asked Questions
        </div>
        <div className="mt-5 space-y-3">
          {faqs.map((faq) => {
            const open = faq.id === openId;
            return (
              <button
                key={faq.id}
                type="button"
                onClick={() => setOpenId(open ? "" : faq.id)}
                className={cn(
                  "w-full rounded-[18px] bg-white p-4 text-left shadow-[0_10px_24px_rgba(38,50,58,0.08)] ring-1 ring-[#E7E0F2] transition",
                  open && "ring-[#BFA9E8]",
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold leading-5 text-[#26323A]">{faq.question}</span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F3EEFC] text-[#5D4A86]">
                    <ChevronIcon expanded={open} />
                  </span>
                </span>
                {open ? <span className="mt-3 block text-sm leading-6 text-[#52616A]">{faq.answer}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ChildEnrollmentSelector({
  program,
  childrenProfiles,
  statuses,
  selfProfileId,
  selectedChildIds,
  onToggle,
  onSubmit,
  busy,
}: {
  program: Program;
  childrenProfiles: StudentDisplay[];
  statuses: Record<string, { enrolled: boolean; requestStatus: string | null }>;
  selfProfileId?: string | null;
  selectedChildIds: string[];
  onToggle: (childId: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Select students</p>
      <div className="mt-2 space-y-2">
        {childrenProfiles.map((child) => {
          const status = statuses[child.id];
          const eligibility = isProfileEligibleForProgram(child, program);
          const locked = status?.enrolled || status?.requestStatus === "pending" || status?.requestStatus === "waitlisted" || !eligibility.eligible;
          const checked = selectedChildIds.includes(child.id);
          const detail = status?.enrolled
            ? "Already enrolled"
            : status?.requestStatus === "pending"
              ? "Pending review"
              : status?.requestStatus === "waitlisted"
                ? "Waitlisted"
                : eligibility.eligible
                  ? ""
                  : eligibility.reason;
          const isSelf = child.id === selfProfileId;
          return (
            <button
              key={child.id}
              type="button"
              onClick={() => (locked ? undefined : onToggle(child.id))}
              disabled={locked}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-[14px] border p-3 text-left text-sm transition",
                checked ? "border-[#17624F] bg-[#EAF7F1] ring-1 ring-[#17624F]" : "border-[#D6DCE0] bg-[#F8FBFC] hover:border-[#9EC8D5]",
                locked && "cursor-not-allowed opacity-65",
              )}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[11px]", checked ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#B9C3C8] bg-white text-transparent")}>
                <CheckIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[#26323A]">
                  {child.full_name ?? "Student"} {isSelf ? "(You)" : ""}
                </span>
                {detail ? <span className={cn("block truncate text-xs", eligibility.eligible ? "text-[#6B747B]" : "text-[#A34B16]")}>{detail}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || selectedChildIds.length === 0}
        className="mt-3 min-h-11 w-full rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(23,98,79,0.18)] disabled:opacity-60"
      >
        {busy ? "Sending..." : "Submit Request"}
      </button>
    </div>
  );
}

function MessageIcon({ className, style }: { className?: string; style?: CSSProperties } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} style={style} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function ProgramTrackSelector({
  tracks,
  selectedTrackIds,
  program,
  onToggle,
}: {
  tracks: ProgramTrack[];
  selectedTrackIds: string[];
  program: Pick<Program, "track_selection_mode" | "track_selection_count">;
  onToggle: (trackId: string) => void;
}) {
  const ruleText = trackSelectionRuleText(program, tracks.length);
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-end justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Choose schedule</p>
        <p className="text-right text-[11px] font-medium text-[#7B858C]">{ruleText}</p>
      </div>
      <div className="space-y-2">
        {tracks.map((track) => {
          const selected = selectedTrackIds.includes(track.id);
          const schedule = scheduleSummary(track.schedule, null);
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => onToggle(track.id)}
              className={cn(
                "w-full rounded-[14px] border p-3 text-left transition",
                selected ? "border-[#17624F] bg-[#EAF7F1] ring-1 ring-[#17624F]" : "border-[#D6DCE0] bg-[#F8FBFC] hover:border-[#9EC8D5]",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-[#26323A]">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-[6px] border text-[11px]", selected ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#B9C3C8] bg-white text-transparent")}>✓</span>
                {track.name}
              </span>
              {track.description ? <span className="mt-1 block text-xs leading-5 text-[#52616A]">{track.description}</span> : null}
              <span className="mt-1 block pl-7 text-xs font-medium text-[#17624F]">{schedule.full}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleTrackControlRow({
  index,
  track,
  trackCount,
  program,
  selectedTrackIds,
  disabled,
  onToggle,
}: {
  index: number;
  track: ProgramTrack;
  trackCount: number;
  program: Pick<Program, "track_selection_mode" | "track_selection_count">;
  selectedTrackIds: string[];
  disabled: boolean;
  onToggle: () => void;
}) {
  const selected = selectedTrackIds.includes(track.id);
  const activeLimit = Math.min(Math.max(1, program.track_selection_count ?? 1), Math.max(1, trackCount));
  const mode = program.track_selection_mode ?? "exact";
  const selectedCount = selectedTrackIds.length;
  const requiredCount = activeLimit;
  const addWouldViolate = !selected && mode === "maximum" && selectedCount >= activeLimit;
  const rowDisabled = disabled || addWouldViolate;
  const schedule = scheduleSummary(track.schedule, null);
  const actionLabel = selected
    ? "Remove"
    : mode === "exact" && selectedCount >= requiredCount
      ? "Switch"
      : addWouldViolate
        ? "Limit"
        : "Add";

  return (
    <button
      type="button"
      disabled={rowDisabled}
      onClick={onToggle}
      className={cn("flex w-full items-start gap-3 py-4 text-left transition", rowDisabled ? "cursor-not-allowed opacity-60" : "hover:bg-[#F7FAFB]")}
    >
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", selected ? "bg-[#17624F] text-white" : "bg-[#EEF3F5] text-[#6B747B]")}>
        {selected ? <CheckIcon /> : String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[#26323A]">{track.name}</span>
          {selected ? <span className="rounded-full bg-[#E6F5EE] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#17624F]">Active</span> : null}
        </span>
        {track.description ? <span className="mt-1 block text-xs leading-5 text-[#6B747B]">{track.description}</span> : null}
        <span className="mt-1 block text-xs font-semibold text-[#2F6F83]">{schedule.full}</span>
      </span>
      <span className={cn("mt-0.5 min-w-16 shrink-0 text-right text-xs font-bold uppercase tracking-wide", selected ? "text-[#17624F]" : "text-[#2F8FB3]")}>{actionLabel}</span>
    </button>
  );
}

function RosterTrackOption({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm font-semibold text-[#26323A] hover:bg-[#F7FAFB]"
    >
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[11px]", checked ? "border-[#17624F] bg-[#17624F] text-white" : "border-[#B9C3C8] bg-white text-transparent")}>✓</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function trackSelectionRuleText(program: Pick<Program, "track_selection_mode" | "track_selection_count">, trackCount: number) {
  const count = Math.min(Math.max(1, program.track_selection_count ?? 1), Math.max(1, trackCount));
  if (program.track_selection_mode === "minimum") {
    return `Select at least ${count}`;
  }
  if (program.track_selection_mode === "maximum") {
    return `Select up to ${count}`;
  }
  return `Select exactly ${count}`;
}

function nextProgramTrackSelection(
  program: Pick<Program, "track_selection_mode" | "track_selection_count">,
  tracks: ProgramTrack[],
  currentTrackIds: string[],
  toggledTrackId: string,
) {
  const current = currentTrackIds.filter((trackId) => tracks.some((track) => track.id === trackId));
  if (current.includes(toggledTrackId)) {
    return current.filter((trackId) => trackId !== toggledTrackId);
  }

  const limit = Math.min(Math.max(1, program.track_selection_count ?? 1), Math.max(1, tracks.length));
  const mode = program.track_selection_mode ?? "exact";
  if (mode === "exact" && limit === 1) {
    return [toggledTrackId];
  }
  if ((mode === "exact" || mode === "maximum") && current.length >= limit) {
    return current;
  }

  return [...current, toggledTrackId];
}

function nextScheduleOptionSelection(
  program: Pick<Program, "track_selection_mode" | "track_selection_count">,
  tracks: ProgramTrack[],
  currentTrackIds: string[],
  toggledTrackId: string,
) {
  const current = currentTrackIds.filter((trackId) => tracks.some((track) => track.id === trackId));
  const selected = current.includes(toggledTrackId);
  const requiredCount = Math.min(Math.max(1, program.track_selection_count ?? 1), Math.max(1, tracks.length));
  const mode = program.track_selection_mode ?? "exact";

  if (selected) {
    return current.filter((trackId) => trackId !== toggledTrackId);
  }

  if (mode === "exact" && current.length >= requiredCount) {
    return [...current.slice(1), toggledTrackId];
  }
  if (mode === "maximum" && current.length >= requiredCount) {
    return current;
  }
  return [...current, toggledTrackId];
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function validateTrackSelection(program: Pick<Program, "track_selection_mode" | "track_selection_count">, tracks: ProgramTrack[], selectedTrackIds: string[]) {
  if (tracks.length === 0) {
    return { valid: true, message: "" };
  }

  const validSelectedCount = selectedTrackIds.filter((trackId) => tracks.some((track) => track.id === trackId)).length;
  const requiredCount = Math.min(Math.max(1, program.track_selection_count ?? 1), tracks.length);
  if (program.track_selection_mode === "minimum" && validSelectedCount < requiredCount) {
    return { valid: false, message: `Choose at least ${requiredCount} schedule option${requiredCount === 1 ? "" : "s"}.` };
  }
  if (program.track_selection_mode === "maximum" && (validSelectedCount < 1 || validSelectedCount > requiredCount)) {
    return { valid: false, message: `Choose up to ${requiredCount} schedule option${requiredCount === 1 ? "" : "s"}.` };
  }
  if ((program.track_selection_mode ?? "exact") === "exact" && validSelectedCount !== requiredCount) {
    return { valid: false, message: `Choose exactly ${requiredCount} schedule option${requiredCount === 1 ? "" : "s"}.` };
  }
  return { valid: true, message: "" };
}

async function replaceEnrollmentRequestTracks(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  requestIds: string[],
  selectedTrackIds: string[],
) {
  if (requestIds.length === 0) {
    return null;
  }

  const { error: deleteError } = await supabase.from("enrollment_request_tracks").delete().in("enrollment_request_id", requestIds);
  if (deleteError) {
    return deleteError.message;
  }

  const rows = requestIds.flatMap((requestId) => selectedTrackIds.map((trackId) => ({ enrollment_request_id: requestId, program_track_id: trackId })));
  if (!rows.length) {
    return null;
  }

  const { error: insertError } = await supabase.from("enrollment_request_tracks").insert(rows);
  return insertError?.message ?? null;
}

function ProgramCardGrid({
  programs,
  mosqueSlug,
  emptyText,
  enrolledProgramIds = [],
  detailBaseHref,
}: {
  programs: ProgramWithTeacher[];
  mosqueSlug: string;
  emptyText: string;
  enrolledProgramIds?: string[];
  detailBaseHref?: string;
}) {
  if (programs.length === 0) {
    return <EmptyState title="No programs available" text={emptyText} />;
  }

  return (
    <div className="grid gap-4 bg-[var(--workspace)] p-4 md:grid-cols-2 lg:grid-cols-3">
      {programs.map((program) => (
        <ProgramCard key={program.id} program={program} enrolled={enrolledProgramIds.includes(program.id)} detailHref={`${detailBaseHref ?? `/m/${mosqueSlug}/programs`}/${program.id}`} />
      ))}
    </div>
  );
}

function EnrolledClassList({ programs, mosqueSlug }: { programs: ProgramWithTeacher[]; mosqueSlug: string }) {
  return (
    <div className="grid gap-4 bg-[var(--workspace)] p-4 md:grid-cols-2">
      {programs.map((program) => (
        <article key={program.id} className="overflow-hidden rounded-[22px] border border-[#CBD8DE] bg-white shadow-[0_16px_40px_rgba(38,50,58,0.09)]">
          <ProgramHero program={program} />
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <span className="inline-flex min-h-7 items-center rounded-full bg-[#E6F5EE] px-3 text-xs font-bold uppercase tracking-wide text-[#17624F]">Enrolled</span>
              <h3 className="line-clamp-2 text-lg font-semibold leading-6 text-[#26323A]">{program.title}</h3>
              <p className="mt-1 text-sm text-[#6B747B]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
            </div>
            <AudienceDetails age={formatAgeRange(program.age_range_text)} gender={formatGender(program.audience_gender)} />
            <div className="divide-y divide-[#E3E8EC] border-t border-[#E3E8EC]">
              <TeacherActionLink href={`/m/${mosqueSlug}/portal/classes/${program.id}/schedule`} icon={<ScheduleIcon />} label="Schedule Options" />
              <TeacherActionLink href={`/m/${mosqueSlug}/programs/${program.id}?returnTo=${encodeURIComponent(`/m/${mosqueSlug}/portal/classes`)}`} icon={<ExternalLinkIcon />} label="Program Details" previewLabel="Program Details" />
              <TeacherActionLink href={`/m/${mosqueSlug}/portal/classes/${program.id}/withdrawal`} icon={<XIcon />} label="Request Withdrawal" previewLabel="Request Withdrawal" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function StudentWithdrawalRequestData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [students, setStudents] = useState<StudentDisplay[]>([]);
  const [existingRequestsByStudentId, setExistingRequestsByStudentId] = useState<Record<string, WithdrawalRequest | null>>({});
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [reason, setReason] = useState("");
  const [understandsNoRefund, setUnderstandsNoRefund] = useState(false);
  const [understandsImmediateExit, setUnderstandsImmediateExit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoading(true);
      setMessage(null);
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;
      if (!userId) {
        setMessage({ tone: "error", text: "Please sign in to request withdrawal." });
        setLoading(false);
        return;
      }

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setMessage({ tone: "error", text: "Masjid not found." });
        setLoading(false);
        return;
      }

      const { data: programRow } = await supabase.from("programs").select("*").eq("id", programId).eq("mosque_id", mosque.id).maybeSingle();
      if (!programRow) {
        setMessage({ tone: "error", text: "Class not found." });
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth, account_type")
        .eq("id", userId)
        .maybeSingle();
      const { children } = profile?.account_type === "parent" ? await fetchParentChildren(supabase, slug, userId, mosque.id) : { children: [] as StudentDisplay[] };
      const possibleStudents = [profile, ...children].filter(Boolean) as StudentDisplay[];
      const possibleStudentIds = possibleStudents.map((student) => student.id);
      const { data: enrollments } = possibleStudentIds.length
        ? await supabase.from("enrollments").select("student_profile_id").eq("program_id", programId).in("student_profile_id", possibleStudentIds)
        : { data: [] as Array<{ student_profile_id: string }> };
      const enrolledIds = new Set((enrollments ?? []).map((enrollment) => enrollment.student_profile_id));
      const enrolledStudents = possibleStudents.filter((student) => enrolledIds.has(student.id));
      const { data: requestRows } = enrolledStudents.length
        ? await supabase.from("withdrawal_requests").select("*").eq("program_id", programId).in("student_profile_id", enrolledStudents.map((student) => student.id)).eq("status", "pending")
        : { data: [] as WithdrawalRequest[] };
      const requestByStudentId = (requestRows ?? []).reduce<Record<string, WithdrawalRequest>>((next, request) => {
        next[request.student_profile_id] = request;
        return next;
      }, {});

      if (!cancelled) {
        setProgram(programRow);
        setStudents(enrolledStudents);
        setExistingRequestsByStudentId(requestByStudentId);
        setSelectedStudentId(enrolledStudents.find((student) => !requestByStudentId[student.id])?.id ?? enrolledStudents[0]?.id ?? "");
        setLoading(false);
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [programId, slug]);

  async function submit() {
    if (!selectedStudentId) {
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const { error: submitError } = await createSupabaseBrowserClient().rpc("request_program_withdrawal", {
      target_program_id: programId,
      target_student_profile_id: selectedStudentId,
      withdrawal_reason: reason.trim() || null,
      understands_no_refund: understandsNoRefund,
      understands_immediate_exit: understandsImmediateExit,
    });
    setSubmitting(false);
    if (submitError) {
      setMessage({ tone: "error", text: submitError.message });
      return;
    }
    setExistingRequestsByStudentId((current) => ({
      ...current,
      [selectedStudentId]: { id: "pending", student_profile_id: selectedStudentId } as WithdrawalRequest,
    }));
    setSubmitted(true);
    setMessage({ tone: "success", text: "Withdrawal request sent. The teacher will review it, and you will be notified when it is done." });
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? null;
  const selectedAlreadyPending = Boolean(selectedStudentId && existingRequestsByStudentId[selectedStudentId]);
  const canSubmit = Boolean(selectedStudentId && understandsNoRefund && understandsImmediateExit && !selectedAlreadyPending && !submitted);

  return (
    <div className="bg-white px-4 pb-28 pt-7 text-[#26323A]">
      {loading ? (
        <InboxLoadingPanel label="Loading withdrawal form" />
      ) : message?.tone === "error" && !program ? (
        <EmptyState title="Could not load withdrawal" text={message.text} />
      ) : submitted ? (
        <div className="space-y-5">
          <div className="rounded-[24px] bg-[#F4FBF8] px-5 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#17624F] text-white">
              <CheckIcon />
            </div>
            <h2 className="mt-4 text-2xl font-semibold leading-8">Request sent</h2>
            <p className="mt-2 text-sm leading-6 text-[#52616A]">
              The teacher will review the withdrawal request. You will be notified when it is done.
            </p>
          </div>
          <TransitionLink href={`/m/${slug}/portal/classes`} label="Classes" className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#26323A] px-4 text-sm font-semibold text-white" style={{ color: "#FFFFFF" }}>
            Back to classes
          </TransitionLink>
        </div>
      ) : program ? (
        <div className="space-y-7">
          <section className="space-y-3 border-b border-[#E3E8EC] pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6B747B]">Class summary</p>
            <div>
              <h2 className="text-2xl font-semibold leading-8">{program.title}</h2>
              <p className="mt-1 text-sm leading-6 text-[#52616A]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
            </div>
            <AudienceDetails age={formatAgeRange(program.age_range_text)} gender={formatGender(program.audience_gender)} />
          </section>

          <section className="space-y-3 border-b border-[#E3E8EC] pb-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#6B747B]">Student</p>
                <h3 className="mt-1 text-lg font-semibold">Who is withdrawing?</h3>
              </div>
              <span className="text-xs font-semibold text-[#6B747B]">{students.length}</span>
            </div>
            {students.length ? (
              <div className="space-y-2">
                {students.map((student) => {
                  const pending = Boolean(existingRequestsByStudentId[student.id]);
                  const selected = selectedStudentId === student.id;
                  return (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => setSelectedStudentId(student.id)}
                      className={cn("flex min-h-14 w-full items-center gap-3 border px-3 text-left transition-colors", selected ? "border-[#17624F] bg-[#F4FBF8]" : "border-[#E1E8EC] bg-white")}
                    >
                      <Avatar src={student.avatar_url ?? null} name={student.full_name ?? "Student"} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{student.full_name ?? "Student"}</span>
                        <span className="block truncate text-xs text-[#6B747B]">{pending ? "Withdrawal already pending" : students.length === 1 ? "Selected by default" : "Enrolled"}</span>
                      </span>
                      {selected ? <CheckIcon /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <MiniEmpty text="No active enrollment was found for this class." />
            )}
          </section>

          <section className="space-y-3 border-b border-[#E3E8EC] pb-6">
            <label htmlFor="withdrawal-reason" className="block text-xs font-semibold uppercase tracking-[0.24em] text-[#6B747B]">Reason optional</label>
            <textarea
              id="withdrawal-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={selectedStudent ? `Reason for withdrawing ${selectedStudent.full_name ?? "this student"}` : "Reason for withdrawal"}
              className="min-h-28 w-full resize-none rounded-[18px] border border-[#C9D4DA] bg-white px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-[#17624F]"
            />
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#6B747B]">Terms</p>
            <WithdrawalAcknowledgement checked={understandsNoRefund} onChange={setUnderstandsNoRefund}>
              I understand that submitting this withdrawal request does not create a refund.
            </WithdrawalAcknowledgement>
            <WithdrawalAcknowledgement checked={understandsImmediateExit} onChange={setUnderstandsImmediateExit}>
              I understand that if approved, the subscription ends and the student leaves the class immediately. Rejoining later requires starting the application process again.
            </WithdrawalAcknowledgement>
          </section>

          {message ? <p className={cn("text-sm font-semibold", message.tone === "success" ? "text-[#17624F]" : "text-[#A34B16]")}>{message.text}</p> : null}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="min-h-12 w-full rounded-full bg-[#26323A] px-4 text-sm font-semibold text-white disabled:bg-[#D8E2E5] disabled:text-[#8A949B]"
          >
            {submitting ? "Sending..." : selectedAlreadyPending ? "Already requested" : "Submit withdrawal request"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WithdrawalAcknowledgement({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex gap-3 rounded-[18px] border border-[#E1E8EC] bg-[#FAFCFC] px-4 py-3 text-sm font-semibold leading-6 text-[#26323A]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#17624F]" />
      <span>{children}</span>
    </label>
  );
}

function DisabledActionRow({ icon, label, tone = "default" }: { icon: ReactNode; label: string; tone?: "default" | "danger" }) {
  return (
    <div className={cn("flex min-h-[58px] items-center gap-3 text-sm font-semibold", tone === "danger" ? "text-[#C83F31]" : "text-[#8A949B]")}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 text-left leading-5">{label}</span>
      <span className="text-xs font-medium text-[#9AA4AA]">Soon</span>
    </div>
  );
}

function ProgramCard({ program, detailHref, enrolled = false }: { program: ProgramWithTeacher; detailHref: string; enrolled?: boolean }) {
  return (
    <TransitionLink href={detailHref} label="Class Details" className={cn("group relative overflow-hidden rounded-xl bg-white shadow-[0_5px_18px_rgba(38,50,58,0.14)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(38,50,58,0.18)]", enrolled && "opacity-70")}>
      <div className="relative">
        <ProgramHero program={program} />
        {enrolled ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/58">
            <span className="rounded-full bg-[#17624F] px-4 py-2 text-sm font-semibold text-white shadow-lg">Enrolled</span>
          </div>
        ) : null}
      </div>
      <PriceTag price={formatPrice(program.price_monthly_cents)} />
      <div className="space-y-3 p-4 pt-5">
        <div className="flex items-start gap-3">
          <Avatar src={program.teacher?.avatar_url ?? null} name={program.teacher?.full_name ?? "Teacher"} />
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-lg font-medium leading-6 text-[#26323A]">{program.title}</h3>
            <p className="mt-1 truncate text-sm text-[#6B747B]">{program.teacher?.full_name ?? "Teacher to be announced"}</p>
          </div>
        </div>
        <AudienceDetails age={formatAgeRange(program.age_range_text)} gender={formatGender(program.audience_gender)} />
      </div>
    </TransitionLink>
  );
}

function ProgramHero({ program }: { program: Program }) {
  if (program.thumbnail_url) {
    return (
      <div className="relative h-36 bg-[#DDE8EE]">
        <Image src={program.thumbnail_url} alt="" fill className="object-cover" />
      </div>
    );
  }

  return (
    <div className="relative flex h-36 items-center justify-center bg-[radial-gradient(circle_at_top_left,#E5FFF0_0,#7ECFC2_52%,#2E9B82_100%)] p-4 text-white/80">
      <PhotoIcon className="h-12 w-12" />
    </div>
  );
}

function PriceTag({ price }: { price: string }) {
  return (
    <div className="absolute right-2 top-[126px] h-11 w-20 rotate-3" aria-label={`Price ${price}`}>
      <div
        className="relative flex h-9 w-20 items-center justify-center pl-3 text-base font-semibold text-[#2A2104] shadow-[0_7px_14px_rgba(91,68,6,0.24)]"
        style={{
          clipPath: "polygon(0 50%, 18% 0, 100% 0, 100% 100%, 18% 100%)",
          background: "linear-gradient(135deg, #FFE37A 0%, #FFC400 38%, #D99A00 100%)",
        }}
      >
        <span className="absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[#B98200] bg-white shadow-inner" aria-hidden />
        <span className="relative z-10">{price}</span>
      </div>
    </div>
  );
}

function AudienceDetails({ age, gender }: { age: string; gender: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#26323A]">
      <div className="flex min-h-7 items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-[#2F8FB3]" aria-hidden />
        <span>{age}</span>
      </div>
      <div className="flex min-h-7 items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#2F8FB3]" aria-hidden />
        <span>{gender}</span>
      </div>
    </div>
  );
}

function HomeNotification({
  tone,
  title,
  text,
  href,
}: {
  tone: "active" | "empty";
  title: string;
  text: string;
  href?: string;
}) {
  if (tone === "empty") {
    return (
      <div className="px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[#26323A]">{title}</h2>
          <p className="mt-0.5 text-sm leading-5 text-[#52616A]">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#E7FFF3_0%,#D4F3EA_52%,#BFE6F3_100%)] px-5 py-4 shadow-[0_14px_34px_rgba(38,50,58,0.08)]">
      <div className="absolute right-[-28px] top-[-38px] h-28 w-28 rounded-full bg-white/45" aria-hidden />
      <div className="relative flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-xl font-medium text-[#17624F]">
          !
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[#26323A]">{title}</h2>
          <p className="mt-0.5 text-sm leading-5 text-[#52616A]">{text}</p>
        </div>
        {href ? (
          <Link href={href} className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-white px-4 text-sm font-semibold text-[#26323A] shadow-[0_10px_22px_rgba(38,50,58,0.12)] ring-1 ring-white/70">
            Inbox
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function HomeSectionTitle({ title }: { title: string }) {
  return (
    <div className="px-1 pt-1">
      <h2 className="text-lg font-semibold text-[#26323A]">{title}</h2>
    </div>
  );
}

function HomeEmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#62AFC3] text-2xl font-medium text-[#62AFC3]">!</div>
      <h3 className="mt-4 text-base font-semibold text-[#26323A]">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-[#6B747B]">{text}</p>
    </div>
  );
}

function HomeLoadingState() {
  return <GenericLoadingState label="Loading home" />;
}

type HomeLesson = {
  program: ProgramScheduleSource;
  ownerLabel?: string;
  trackKey?: string;
  trackName?: string;
  date: Date;
  startsAt: Date;
  endsAt: Date | null;
  start: string;
  end: string;
  color: string;
};

function HomeUpcomingRows({
  programs,
  ownerLabelsByProgramId = {},
  canCancelSessions = false,
  currentUserId = null,
}: {
  programs: ProgramScheduleSource[];
  ownerLabelsByProgramId?: Record<string, string[]>;
  canCancelSessions?: boolean;
  currentUserId?: string | null;
}) {
  const [cancellations, setCancellations] = useState<ProgramSessionCancellation[]>([]);
  const [cancellationsLoadedKey, setCancellationsLoadedKey] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<HomeLesson | null>(null);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const week = currentWeekDays();
  const weekStartKey = dayKey(week[0]);
  const weekEndKey = dayKey(week[week.length - 1]);
  const programKey = programs.map((program) => program.id).sort().join("|");
  const cancellationLoadKey = `${programKey}:${weekStartKey}:${weekEndKey}`;
  const lessonSources: Array<{ program: Program | ProgramWithTeacher; ownerLabel?: string }> = programs.flatMap((program) => {
    const labels = ownerLabelsByProgramId[program.id] ?? [];
    return labels.length ? labels.map((ownerLabel) => ({ program, ownerLabel })) : [{ program }];
  });
  const cancellationKeys = new Set(cancellations.map((cancellation) => sessionCancellationKey(cancellation.program_id, cancellation.session_date, cancellation.start_time)));
  const lessons = weekLessons(lessonSources, week)
    .filter((lesson) => !cancellationKeys.has(lessonCancellationKey(lesson)))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const upcomingLessons = lessons.filter((lesson) => !lessonHasEnded(lesson));

  useEffect(() => {
    const programIds = Array.from(new Set(programs.map((program) => program.id)));
    if (programIds.length === 0) {
      setCancellations([]);
      setCancellationsLoadedKey(cancellationLoadKey);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    let active = true;
    setCancellationsLoadedKey((current) => (current === cancellationLoadKey ? current : null));

    supabase
      .from("program_session_cancellations")
      .select("*")
      .in("program_id", programIds)
      .gte("session_date", weekStartKey)
      .lte("session_date", weekEndKey)
      .then(({ data }) => {
        if (active) {
          setCancellations(data ?? []);
          setCancellationsLoadedKey(cancellationLoadKey);
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey, weekStartKey, weekEndKey]);

  function openCancelModal(lesson: HomeLesson) {
    setCancelTarget(lesson);
    setCancelError(null);
    setCancelMessage(defaultCancellationMessage(lesson));
  }

  async function cancelSession() {
    if (!cancelTarget || !currentUserId) {
      return;
    }

    setCancelBusy(true);
    setCancelError(null);
    const supabase = createSupabaseBrowserClient();
    const message = cancelMessage.trim();
    let announcementId: string | null = null;

    if (message) {
      const { data: announcement, error: announcementError } = await supabase
        .from("program_announcements")
        .insert({
          program_id: cancelTarget.program.id,
          author_profile_id: currentUserId,
          message,
        })
        .select("id")
        .single();

      if (announcementError) {
        setCancelError(announcementError.message);
        setCancelBusy(false);
        return;
      }

      announcementId = announcement?.id ?? null;
    }

    const { data: cancellation, error: cancellationError } = await supabase
      .from("program_session_cancellations")
      .upsert(
        {
          program_id: cancelTarget.program.id,
          session_date: dayKey(cancelTarget.date),
          start_time: cancelTarget.start,
          end_time: cancelTarget.end,
          cancelled_by: currentUserId,
          announcement_id: announcementId,
          note: message || null,
        },
        { onConflict: "program_id,session_date,start_time" },
      )
      .select("*")
      .single();

    if (cancellationError) {
      setCancelError(cancellationError.message);
      setCancelBusy(false);
      return;
    }

    if (cancellation) {
      setCancellations((current) => [
        ...current.filter((item) => sessionCancellationKey(item.program_id, item.session_date, item.start_time) !== sessionCancellationKey(cancellation.program_id, cancellation.session_date, cancellation.start_time)),
        cancellation,
      ]);
    }

    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    setCancelBusy(false);
    setCancelTarget(null);
    setCancelMessage("");
  }

  if (cancellationsLoadedKey !== cancellationLoadKey) {
    return <HomeUpcomingLoadingRows />;
  }

  if (lessons.length === 0) {
    return <HomeEmptyState title="No upcoming classes" text="Upcoming sessions will appear here after schedules are added." />;
  }

  const lessonsByDay = new Map<string, HomeLesson[]>();
  for (const lesson of lessons) {
    const key = dayKey(lesson.date);
    lessonsByDay.set(key, [...(lessonsByDay.get(key) ?? []), lesson]);
  }

  const upcomingLessonsByDay = new Map<string, HomeLesson[]>();
  for (const lesson of upcomingLessons) {
    const key = dayKey(lesson.date);
    upcomingLessonsByDay.set(key, [...(upcomingLessonsByDay.get(key) ?? []), lesson]);
  }

  return (
    <div className="space-y-5">
      <WeekCalendar days={week} lessonsByDay={lessonsByDay} />
      {upcomingLessons.length === 0 ? (
        <HomeEmptyState title="No more classes this week" text="Your scheduled class days are shown above." />
      ) : (
        <div className="space-y-5">
          {week
            .map((day) => ({ day, lessons: upcomingLessonsByDay.get(dayKey(day)) ?? [] }))
            .filter((group) => group.lessons.length > 0)
            .map((group) => (
              <section key={dayKey(group.day)} className="space-y-2">
                <h3 className="px-1 text-sm font-semibold text-[#26323A]">{formatHomeDate(group.day)}</h3>
                <div className="space-y-3">
                  {group.lessons.map((lesson) => (
                    <HomeUpcomingLesson key={`${lesson.program.id}-${lesson.ownerLabel ?? "self"}-${lesson.date.toISOString()}-${lesson.start}`} lesson={lesson} canCancel={canCancelSessions} onCancel={() => openCancelModal(lesson)} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172522]/45 px-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-[0_24px_70px_rgba(23,37,34,0.28)]">
            <h3 className="text-xl font-semibold text-[#26323A]">Cancel session?</h3>
            <p className="mt-2 text-sm leading-6 text-[#6B747B]">
              By continuing, you will cancel {cancelTarget.program.title} on {formatHomeDate(cancelTarget.date)}.
            </p>
            <textarea
              value={cancelMessage}
              onChange={(event) => setCancelMessage(event.target.value)}
              placeholder="Optional announcement to send to enrolled students"
              className="mt-4 min-h-28 w-full resize-none rounded-[18px] border border-[#D6DCE0] bg-[#F7F9FA] px-4 py-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
            />
            {cancelError ? <p className="mt-3 text-sm text-[#C83F31]">{cancelError}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setCancelTarget(null)} disabled={cancelBusy} className="min-h-10 rounded-[8px] bg-[#EEF2F4] px-5 text-sm font-semibold text-[#5C6870] disabled:opacity-60">
                Keep
              </button>
              <button type="button" onClick={cancelSession} disabled={cancelBusy} className="min-h-10 rounded-[8px] bg-[#C83F31] px-5 text-sm font-semibold text-white disabled:opacity-60">
                {cancelBusy ? "Cancelling..." : "Cancel and send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HomeUpcomingLoadingRows() {
  return <GenericLoadingState label="Loading upcoming classes" />;
}

function WeekCalendar({ days, lessonsByDay }: { days: Date[]; lessonsByDay: Map<string, HomeLesson[]> }) {
  const today = new Date();
  return (
    <div className="grid grid-cols-7 gap-1 px-1">
      {days.map((day) => {
        const lessons = lessonsByDay.get(dayKey(day)) ?? [];
        const isToday = day.toDateString() === today.toDateString();
        return (
          <div key={dayKey(day)} className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex min-h-14 w-full max-w-12 flex-col items-center justify-center rounded-2xl text-center transition-colors",
                isToday ? "bg-[#DDF3EA] text-[#17624F] shadow-[0_8px_18px_rgba(23,98,79,0.12)]" : "text-[#6B747B]",
              )}
            >
              <span className="text-[11px] font-semibold uppercase leading-none">{weekdayShort(day)}</span>
              <span className="mt-1 text-sm font-semibold leading-none">{day.getDate()}</span>
            </div>
            <div className="-mt-1.5 flex h-2 items-center justify-center gap-0.5">
              {Array.from(new Map(lessons.map((lesson) => [lesson.trackKey ?? lesson.program.id, lesson])).values())
                .slice(0, 3)
                .map((lesson) => (
                  <span key={lesson.trackKey ?? lesson.program.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lesson.color }} aria-hidden />
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HomeUpcomingLesson({ lesson, canCancel = false, onCancel }: { lesson: HomeLesson; canCancel?: boolean; onCancel?: () => void }) {
  const detailParts = [lesson.ownerLabel, lesson.trackName, lessonTimeRange(lesson)].filter(Boolean);
  return (
    <div className="flex items-center gap-3 rounded-[24px] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(38,50,58,0.06)]">
      <HomeProgramThumb program={lesson.program} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-[#26323A]">{lesson.program.title}</h3>
        <p className="mt-0.5 truncate text-sm text-[#6B747B]">{detailParts.join(" • ")}</p>
      </div>
      {canCancel ? (
        <UpcomingLessonActionMenu onCancel={onCancel} />
      ) : (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lesson.color }} aria-hidden />
      )}
    </div>
  );
}

function UpcomingLessonActionMenu({ onCancel }: { onCancel?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((value) => !value)}
        className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors", menuOpen ? "bg-[#26323A] text-white" : "text-[#52616A] hover:bg-[#EEF3F5] hover:text-[#26323A]")}
        aria-label="Session actions"
      >
        <MoreVerticalIcon />
      </button>
      {menuOpen ? (
        <span className="absolute right-0 top-10 z-30 w-36 overflow-hidden rounded-[16px] border border-[#DDE5E9] bg-white p-1 text-sm shadow-[0_18px_44px_rgba(38,50,58,0.18)]">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onCancel?.();
            }}
            className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left font-semibold text-[#C83F31] hover:bg-[#FFF1EF]"
          >
            Cancel
          </button>
        </span>
      ) : null}
    </span>
  );
}

function HomeProgramThumb({ program }: { program: ProgramScheduleSource }) {
  if (program.thumbnail_url) {
    return (
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-[#DDE8EE]">
        <Image src={program.thumbnail_url} alt="" fill className="object-cover" sizes="56px" />
      </div>
    );
  }

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#E7F3F8] text-sm font-semibold text-[#2F8FB3]">
      {initials(program.title)}
    </div>
  );
}

function currentWeekDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return date;
  });
}

function weekLessons(sources: Array<{ program: ProgramScheduleSource; ownerLabel?: string }>, week: Date[]) {
  const lessons: HomeLesson[] = [];

  sources.forEach(({ program, ownerLabel }) => {
    const trackSources = program.scheduleTracks?.length
      ? program.scheduleTracks.map((track) => ({ trackKey: `${program.id}:${track.id}`, trackName: track.name, rows: parseProgramSchedule(track.schedule) }))
      : [{ trackKey: program.id, trackName: undefined, rows: parseProgramSchedule(program.schedule) }];

    trackSources.forEach(({ trackKey, trackName, rows }) => {
      const trackColor = programLessonColor(trackKey);
      rows.forEach((row) => {
        const date = week.find((day) => weekdayName(day).toLowerCase() === row.day.toLowerCase());
        if (!date) {
          return;
        }

        const startsAt = withTime(date, row.start);
        lessons.push({
          program,
          ownerLabel,
          trackKey,
          trackName,
          date,
          startsAt,
          endsAt: row.end ? withTime(date, row.end) : null,
          start: row.start,
          end: row.end,
          color: trackColor,
        });
      });
    });
  });

  return lessons;
}

function lessonHasEnded(lesson: HomeLesson) {
  const now = new Date();
  if (lesson.date.toDateString() !== now.toDateString()) {
    return lesson.date < startOfToday();
  }

  return lesson.endsAt ? lesson.endsAt.getTime() <= now.getTime() : false;
}

function withTime(date: Date, time: string) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return next;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayName(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function weekdayShort(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1);
}

function formatHomeDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function lessonTimeRange(lesson: HomeLesson) {
  return formatScheduleRange(lesson.start, lesson.end);
}

function sessionCancellationKey(programId: string, sessionDate: string, startTime: string) {
  return `${programId}|${sessionDate}|${normalizeScheduleTime(startTime) || startTime}`;
}

function lessonCancellationKey(lesson: HomeLesson) {
  return sessionCancellationKey(lesson.program.id, dayKey(lesson.date), lesson.start);
}

function defaultCancellationMessage(lesson: HomeLesson) {
  return `${lesson.program.title} on ${formatHomeDate(lesson.date)} from ${lessonTimeRange(lesson)} has been cancelled.`;
}

function TeacherClassCard({
  program,
  mosqueSlug,
  role,
  basePath,
  controlLabel,
  canManageFinances = false,
  onResigned,
  onResignError,
}: {
  program: Program;
  mosqueSlug: string;
  role: TeacherProgramRole;
  basePath?: string;
  controlLabel?: string;
  canManageFinances?: boolean;
  onResigned?: () => void;
  onResignError?: (message: string) => void;
}) {
  const [resignOpen, setResignOpen] = useState(false);
  const [resigning, setResigning] = useState(false);
  const schedule = scheduleSummary(program.schedule, program.schedule_notes);
  const age = formatAgeRange(program.age_range_text);
  const gender = formatGender(program.audience_gender);
  const isDirector = role === "director";
  const classBasePath = basePath ?? `/m/${mosqueSlug}/teacher/classes`;
  const teacherClassesReturnTo = encodeURIComponent(classBasePath);
  const publicHref = `/m/${mosqueSlug}/programs/${program.id}?returnTo=${teacherClassesReturnTo}`;
  const primaryHref = isDirector ? `${classBasePath}/${program.id}` : publicHref;
  const primaryLabel = isDirector ? "Edit Program" : "Public Page";

  async function resignFromClass() {
    setResigning(true);
    const { error: resignError } = await createSupabaseBrowserClient().rpc("resign_program_instructor", { target_program_id: program.id });
    setResigning(false);
    if (resignError) {
      onResignError?.(resignError.message);
      return;
    }
    setResignOpen(false);
    onResigned?.();
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
  }

  return (
    <article className="overflow-hidden rounded-[22px] border border-[#CBD8DE] bg-white shadow-[0_16px_40px_rgba(38,50,58,0.09)]">
      <TransitionLink href={primaryHref} label={primaryLabel} className="block transition-opacity hover:opacity-95">
        <ProgramHero program={program} />
      </TransitionLink>
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <span className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold uppercase tracking-wide", controlLabel ? "bg-[#E7F3F8] text-[#2F6077]" : isDirector ? "bg-[#E6F5EE] text-[#17624F]" : "bg-[#EEF4F7] text-[#2F6077]")}>
            {controlLabel ?? (isDirector ? "Director" : "Instructor")}
          </span>
          <TransitionLink href={primaryHref} label={primaryLabel} className="line-clamp-2 text-lg font-semibold leading-6 text-[#26323A] hover:text-[#17624F]">
            {program.title}
          </TransitionLink>
          <p className="mt-1 text-sm text-[#6B747B]">{schedule.full}</p>
        </div>
        <AudienceDetails age={age} gender={gender} />
        <div className="divide-y divide-[#E3E8EC] border-t border-[#E3E8EC]">
          <TeacherActionLink href={publicHref} icon={<ExternalLinkIcon />} label="View Public Page" previewLabel="Class Details" />
          <TeacherActionLink href={`${classBasePath}/${program.id}/students`} icon={<StudentsIcon />} label="Students" />
          {isDirector ? <TeacherActionLink href={`${classBasePath}/${program.id}/instructors`} icon={<InstructorManageIcon />} label="Instructors" /> : null}
          <TeacherActionLink href={`${classBasePath}/${program.id}/announcement`} icon={<MegaphoneIcon />} label="Announcement" />
          {canManageFinances ? <TeacherActionLink href={`${classBasePath}/${program.id}/finances`} icon={<FinanceIcon />} label="Manage Finances" /> : null}
          {isDirector ? <TeacherActionLink href={`${classBasePath}/${program.id}`} icon={<EditClassIcon />} label="Edit Program" /> : null}
          {!isDirector ? <TeacherActionButton icon={<XIcon />} label="Resign from Class" onClick={() => setResignOpen(true)} /> : null}
        </div>
      </div>
      {resignOpen ? (
        <ConfirmInstructorResignModal
          programTitle={program.title}
          busy={resigning}
          onCancel={() => setResignOpen(false)}
          onConfirm={() => void resignFromClass()}
        />
      ) : null}
    </article>
  );
}

function programLessonColor(programId: string) {
  let hash = 0;
  for (let index = 0; index < programId.length; index += 1) {
    hash = (hash * 31 + programId.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 58 + (hash % 18);
  const lightness = 42 + (hash % 10);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function TeacherActionLink({ href, icon, label, previewLabel }: { href: string; icon: ReactNode; label: string; previewLabel?: string }) {
  return (
    <TransitionLink href={href} label={previewLabel ?? label} className="group flex min-h-[58px] items-center gap-3 text-sm font-semibold text-[#26323A] transition hover:bg-[#F7FAFB]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#26323A] transition group-hover:text-[#17624F]" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left leading-5">{label}</span>
      <ChevronRightIcon className="text-[#9AA4AA]" />
    </TransitionLink>
  );
}

function TeacherActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-[58px] w-full items-center gap-3 text-sm font-semibold text-[#26323A] transition hover:bg-[#F7FAFB]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[#26323A] transition group-hover:text-[#17624F]" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left leading-5">{label}</span>
      <ChevronRightIcon className="text-[#9AA4AA]" />
    </button>
  );
}

function ConfirmInstructorResignModal({
  programTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  programTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-[#26323A] shadow-[0_24px_60px_rgba(38,50,58,0.22)]">
        
        <h2 className="mt-4 text-xl font-semibold">Resign from class?</h2>
        <p className="mt-2 text-sm leading-6 text-[#6B747B]">
          You are leaving {programTitle}. To rejoin, you will need a new instructor code from the director.
        </p>
        <div className="mt-6 grid gap-2">
          <button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 rounded-[8px] bg-[#26323A] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Leaving..." : "Resign from class"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-[8px] bg-[#EEF3F5] px-4 text-sm font-semibold text-[#52616A] disabled:opacity-60">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TeacherOtherClassCard({ program, mosqueSlug }: { program: Program; mosqueSlug: string }) {
  const schedule = scheduleSummary(program.schedule, program.schedule_notes);
  const publicHref = `/m/${mosqueSlug}/programs/${program.id}?returnTo=${encodeURIComponent(`/m/${mosqueSlug}/teacher/classes`)}`;
  return (
    <article className="rounded-[20px] border border-[#D6DCE0] bg-white p-4 shadow-[0_12px_28px_rgba(38,50,58,0.07)]">
      <div className="flex gap-3">
        <HomeProgramThumb program={program} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-base font-semibold text-[#26323A]">{program.title}</h3>
          <p className="mt-1 text-sm text-[#6B747B]">{schedule.full}</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-[#E3E8EC] border-t border-[#E3E8EC]">
        <TeacherActionLink href={publicHref} icon={<ExternalLinkIcon />} label="View Public Page" previewLabel="Class Details" />
      </div>
    </article>
  );
}

function TeacherWorkspaceTools({ slug, mode, canCreateClass, createHref }: { slug: string; mode: "create" | "invite"; canCreateClass: boolean; createHref?: string }) {
  const [teacherMembership, setTeacherMembership] = useState<MosqueMembership | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [invitePreview, setInvitePreview] = useState<{ programId: string; title: string; directorName: string } | null>(null);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(false);
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [busy, setBusy] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const inviteInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void (async () => {
        setMembershipLoading(true);
        const supabase = createSupabaseBrowserClient();
        const session = await loadCachedSession();
        const userId = session?.user.id ?? null;
        const { data: mosqueRow } = await supabase.from("mosques").select("*").eq("slug", slug).maybeSingle();
        if (mosqueRow && userId) {
          const { data: membershipRow } = await supabase
            .from("mosque_memberships")
            .select("*")
            .eq("mosque_id", mosqueRow.id)
            .eq("profile_id", userId)
            .eq("role", "teacher")
            .maybeSingle();
          setTeacherMembership(membershipRow ?? null);
        }
        setMembershipLoading(false);
      })();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  const isActiveTeacher = teacherMembership?.status === "active";

  useEffect(() => {
    const code = inviteCode.trim().toUpperCase();
    if (mode !== "invite" || code.length !== 8) {
      setInvitePreview(null);
      setInvitePreviewLoading(false);
      setInvitePreviewError(null);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void (async () => {
        setInvitePreviewLoading(true);
        const supabase = createSupabaseBrowserClient();
        const { data: previewRows, error: previewError } = await supabase.rpc("lookup_program_instructor_code", { invite: code });
        const previewRow = previewRows?.[0] ?? null;
        if (previewError) {
          if (!cancelled) {
            setInvitePreview(null);
            setInvitePreviewLoading(false);
            setInvitePreviewError(previewError.message);
          }
          return;
        }
        if (!previewRow) {
          if (!cancelled) {
            setInvitePreview(null);
            setInvitePreviewLoading(false);
            setInvitePreviewError(null);
          }
          return;
        }
        if (!cancelled) {
          setInvitePreviewError(null);
          setInvitePreview({
            programId: previewRow.program_id,
            title: previewRow.title,
            directorName: previewRow.director_name,
          });
          setInvitePreviewLoading(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [inviteCode, mode]);

  async function claimInviteCode() {
    if (!inviteCode.trim()) {
      return;
    }

    setBusy(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error: claimError } = await supabase.rpc("claim_program_instructor_code", {
      invite: inviteCode.trim().toUpperCase(),
    });
    setBusy(false);
    if (claimError) {
      setMessage(claimError.message);
      return;
    }
    setInviteCode("");
    setInvitePreview(null);
    setShowInviteInput(false);
    setToast({ tone: "success", message: "Instructor code accepted. The class is now assigned to you." });
    window.dispatchEvent(new Event("tareeqah:programs-changed"));
    window.setTimeout(() => window.location.reload(), 450);
  }

  async function pasteInviteCode() {
    const clipboardText = await navigator.clipboard.readText().catch(() => "");
    const normalizedCode = clipboardText.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
    if (!normalizedCode) {
      setMessage("Clipboard does not contain an instructor code.");
      return;
    }
    setMessage(null);
    setInviteCode(normalizedCode);
    inviteInputRef.current?.focus();
  }

  const inviteChars = inviteCode.padEnd(8, " ").slice(0, 8).split("");

  return (
    <section className={cn("space-y-3", mode === "invite" && "rounded-[30px] bg-[#17624F] p-5 text-white shadow-[0_18px_40px_rgba(23,98,79,0.24)]")}>
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      {mode === "invite" && !membershipLoading && !isActiveTeacher ? (
        <div className="rounded-[14px] border border-white/25 bg-white/14 px-3 py-2 text-sm text-white">
          A teacher account is required to use instructor codes.
        </div>
      ) : null}

      {mode === "invite" ? (
        <div className="space-y-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/65">Instructor access</p>
            <h2 className="mt-1 text-xl font-semibold leading-6">Join With Instructor Code</h2>
            <p className="mt-3 text-sm leading-5 text-white/78">
              Enter the one-time code shared by the class director to join as an instructor.
            </p>
          </div>

          {!showInviteInput ? (
            <button
              type="button"
              disabled={!isActiveTeacher}
              onClick={() => setShowInviteInput(true)}
              className="min-h-11 w-full rounded-full bg-white px-4 text-sm font-semibold text-[#17624F] shadow-[0_10px_22px_rgba(10,45,36,0.16)] disabled:opacity-60"
            >
              Enter Code
            </button>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="sr-only">Instructor code</span>
                <input
                  ref={inviteInputRef}
                  value={inviteCode}
                  maxLength={8}
                  onChange={(event) => setInviteCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())}
                  className="sr-only"
                  autoFocus
                />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => inviteInputRef.current?.focus()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      inviteInputRef.current?.focus();
                    }
                  }}
                  className="grid grid-cols-8 gap-1.5"
                >
                  {inviteChars.map((char, index) => (
                    <span
                      key={index}
                      className="flex aspect-[0.78] min-w-0 items-center justify-center rounded-[10px] bg-white text-base font-semibold text-[#17624F] shadow-[0_8px_18px_rgba(10,45,36,0.12)]"
                    >
                      {char.trim() || ""}
                    </span>
                  ))}
                </div>
              </label>

              <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                <button
                  type="button"
                  onClick={() => void pasteInviteCode()}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/20 transition-colors hover:bg-white/24"
                  aria-label="Paste instructor code"
                >
                  <ClipboardIcon />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInviteCode("");
                    setShowInviteInput(false);
                  }}
                  className="min-h-11 rounded-full bg-white/16 px-4 text-sm font-semibold text-white ring-1 ring-white/20"
                >
                  Cancel
                </button>
              </div>
              {inviteCode.trim().length === 8 ? (
                <div className="rounded-[18px] bg-white p-4 text-[#26323A] shadow-[0_12px_26px_rgba(10,45,36,0.14)]">
                  {invitePreviewLoading ? (
                    <p className="text-sm font-semibold text-[#6B747B]">Checking code...</p>
                  ) : invitePreviewError ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[#C84B3E]">{invitePreviewError}</p>
                      <button type="button" onClick={() => setInviteCode("")} className="min-h-9 rounded-full bg-[#EEF3F5] px-3 text-xs font-semibold text-[#52616A]">Clear</button>
                    </div>
                  ) : invitePreview ? (
                    <>
                      <p className="text-sm font-semibold text-[#26323A]">{invitePreview.title}</p>
                      <p className="mt-1 text-xs font-medium text-[#6B747B]">Directed by {invitePreview.directorName}</p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setInviteCode("")} className="min-h-10 rounded-full bg-[#EEF3F5] px-3 text-sm font-semibold text-[#52616A]">
                          Not this class
                        </button>
                        <button type="button" disabled={busy || !isActiveTeacher} onClick={() => void claimInviteCode()} className="min-h-10 rounded-full bg-[#17624F] px-3 text-sm font-semibold text-white disabled:opacity-50">
                          {busy ? "Joining..." : "Join Class"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[#C84B3E]">No class found for this code.</p>
                      <button type="button" onClick={() => setInviteCode("")} className="min-h-9 rounded-full bg-[#EEF3F5] px-3 text-xs font-semibold text-[#52616A]">Clear</button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {mode === "create" ? (
        <div className="flex justify-center">
          {canCreateClass ? (
            <TransitionLink href={createHref ?? `/m/${slug}/teacher/classes/new`} label="Add Class" className="min-h-10 rounded-[10px] border border-[#D6DCE0] bg-white px-4 py-2 text-sm font-semibold text-[#52616A] shadow-[0_8px_18px_rgba(38,50,58,0.04)]">
              + Add class
            </TransitionLink>
          ) : (
            <button type="button" disabled className="min-h-10 rounded-[10px] border border-[#D6DCE0] bg-white px-4 text-sm font-semibold text-[#52616A] shadow-[0_8px_18px_rgba(38,50,58,0.04)] disabled:opacity-60">
              + Add class
            </button>
          )}
        </div>
      ) : null}

      {message ? <p className={cn("text-sm", mode === "invite" ? "text-white/82" : "text-[#6B747B]")}>{message}</p> : null}
    </section>
  );
}

function ProgramTeacherStaffTools({ program }: { program: Program }) {
  const [isDirector, setIsDirector] = useState(false);
  const [instructors, setInstructors] = useState<Array<ProgramTeacher & { profile?: Profile | null }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastState | null>(null);
  const [latestInviteCode, setLatestInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadStaff() {
    const supabase = createSupabaseBrowserClient();
    const [{ data: directorAllowed }, { data: assignments }] = await Promise.all([
      supabase.rpc("is_program_director", { check_program_id: program.id }),
      supabase.from("program_teachers").select("*").eq("program_id", program.id).order("created_at", { ascending: true }),
    ]);

    setIsDirector(Boolean(directorAllowed));
    const profileIds = (assignments ?? []).map((assignment) => assignment.teacher_profile_id).filter(Boolean) as string[];
    const { data: profiles } = profileIds.length ? await supabase.from("profiles").select("*").in("id", profileIds) : { data: [] as Profile[] };
    setInstructors(
      (assignments ?? [])
        .filter((assignment) => assignment.role === "instructor")
        .map((assignment) => ({
          ...assignment,
          profile: assignment.teacher_profile_id ? (profiles ?? []).find((profile) => profile.id === assignment.teacher_profile_id) ?? null : null,
        })),
    );
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadStaff();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id]);

  async function generateInstructorCode() {
    setBusy(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const code = generateInviteCode();
    const { error: insertError } = await supabase.from("program_teachers").insert({
      program_id: program.id,
      teacher_profile_id: null,
      role: "instructor",
      invite_code: code,
      invite_code_created_at: new Date().toISOString(),
    });
    setBusy(false);
    if (insertError) {
      setMessage(insertError.message);
      return;
    }
    setLatestInviteCode(code);
    setMessage("Instructor code generated.");
    await loadStaff();
  }

  async function copyInviteCode(code: string | null) {
    if (!code) {
      return;
    }

    await navigator.clipboard.writeText(code).catch(() => null);
    setToast({ tone: "success", message: "Instructor code copied to clipboard." });
  }

  async function removeInstructor(assignmentId: string) {
    setBusy(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error: deleteError } = await supabase.from("program_teachers").delete().eq("id", assignmentId).eq("role", "instructor");
    setBusy(false);
    if (deleteError) {
      setMessage(deleteError.message);
      return;
    }
    await loadStaff();
  }

  if (!isDirector) {
    return null;
  }

  const unusedCodes = instructors.filter((assignment) => !assignment.teacher_profile_id && assignment.invite_code);
  const activeInstructors = instructors.filter((assignment) => assignment.teacher_profile_id);
  const featuredCode = latestInviteCode ?? unusedCodes[unusedCodes.length - 1]?.invite_code ?? null;

  return (
    <section className="space-y-6 bg-white px-4 pb-24 pt-4">
      <EditorToast toast={toast} onClose={() => setToast(null)} />
      <div className="rounded-[30px] bg-[#17624F] p-5 text-white shadow-[0_18px_40px_rgba(23,98,79,0.24)]">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-6">Invite An Instructor</h2>
          <p className="mt-1 truncate text-sm font-medium text-white/72">{program.title}</p>
          
        </div>

        <div className="mt-6 grid grid-cols-8 gap-1.5">
          {(featuredCode ?? "--------").split("").map((char, index) => (
            <span
              key={`${char}-${index}`}
              className="flex aspect-[0.78] min-w-0 items-center justify-center rounded-[10px] bg-white text-base font-semibold text-[#17624F] shadow-[0_8px_18px_rgba(10,45,36,0.12)]"
            >
              {char}
            </span>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={generateInstructorCode}
            className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold text-[#17624F] shadow-[0_10px_22px_rgba(10,45,36,0.16)] disabled:opacity-60"
          >
            New Code
          </button>
          <button
            type="button"
            disabled={!featuredCode}
            onClick={() => void copyInviteCode(featuredCode)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/20 transition-colors hover:bg-white/24 disabled:opacity-45"
            aria-label="Copy instructor code"
          >
            <CopyIcon />
          </button>
        </div>
      </div>

      {message ? <div className="px-1 text-sm font-semibold text-[#17624F]">{message}</div> : null}

      <section className="space-y-2">
        <h2 className="px-1 text-lg font-semibold text-[#26323A]">Instructors</h2>
        {activeInstructors.length ? (
          <div className="divide-y divide-[#EEF2F4]">
            {activeInstructors.map((assignment) => (
              <div key={assignment.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#26323A]">{assignment.profile?.full_name || assignment.profile?.email || "Assigned instructor"}</p>
                  <p className="truncate text-sm text-[#6B747B]">{assignment.profile?.email || (assignment.teacher_profile_id ? "Profile hidden until permissions are applied" : "Instructor")}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => void removeInstructor(assignment.id)} className="min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold text-[#C83F31] disabled:opacity-60">
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <MiniEmpty text="No instructors have joined yet." />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-lg font-semibold text-[#26323A]">Unused Codes</h2>
        {unusedCodes.length ? (
          <div className="divide-y divide-[#EEF2F4]">
            {unusedCodes.map((assignment) => (
              <div key={assignment.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold tracking-[0.12em] text-[#26323A]">{assignment.invite_code}</p>
                  <p className="mt-0.5 text-sm text-[#7B858C]">Code not claimed yet</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => void copyInviteCode(assignment.invite_code)} className="flex h-9 w-9 items-center justify-center rounded-full text-[#52616A] hover:bg-[#EEF3F5]" aria-label="Copy unused instructor code">
                    <CopyIcon />
                  </button>
                  <button type="button" disabled={busy} onClick={() => void removeInstructor(assignment.id)} className="min-h-9 rounded-full px-3 text-sm font-semibold text-[#C83F31] disabled:opacity-60">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <MiniEmpty text="No unused instructor codes." />
        )}
      </section>
    </section>
  );
}

function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function AccountPanelFrame({ children }: { children: ReactNode }) {
  return <div className="w-full shrink-0 px-1 pb-24">{children}</div>;
}

function AccountAvatar({ src, name, size = "lg" }: { src: string | null; name: string; size?: "sm" | "lg" }) {
  const sizeClass = size === "sm" ? "h-16 w-16 text-xl shadow-[0_10px_26px_rgba(38,50,58,0.1)]" : "h-32 w-32 text-4xl shadow-[0_18px_42px_rgba(38,50,58,0.12)]";
  if (src) {
    return <Image src={src} alt="" width={128} height={128} className={cn(sizeClass, "rounded-full object-cover")} />;
  }

  return (
    <div className={cn("flex items-center justify-center rounded-full bg-gradient-to-br from-[#DAF7ED] via-[#D9EEF3] to-[#80BDAF] font-semibold text-[#17624F]", sizeClass)}>
      {initials(name)}
    </div>
  );
}

function AccountMenuButton({
  icon,
  label,
  tone = "default",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[74px] w-full items-center gap-4 text-left transition-colors hover:bg-[#F2F6F7]">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center", tone === "danger" ? "text-[#C83F31]" : "text-[#26323A]")}>{icon}</span>
      <span className={cn("min-w-0 flex-1 text-[15px] font-semibold", tone === "danger" ? "text-[#C83F31]" : "text-[#26323A]")}>{label}</span>
      <ChevronRightIcon className={tone === "danger" ? "text-[#C83F31]" : "text-[#9AA4AA]"} />
    </button>
  );
}

function AccountSubpageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex min-h-12 items-center gap-4">
      <button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#26323A] shadow-[0_10px_22px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]" aria-label="Back">
        <BackArrowIcon />
      </button>
      <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[#1F2A31]">{title}</h1>
    </header>
  );
}

function AccountDetailGroup({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-[#E3E8EC] rounded-[28px] bg-white px-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">{children}</dl>;
}

function EditableProfileRow({
  label,
  value,
  editValue,
  editing,
  saving,
  placeholder,
  inputType = "text",
  inputMode,
  onEdit,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  editValue: string;
  editing: boolean;
  saving: boolean;
  placeholder?: string;
  inputType?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal" | "search" | "url";
  onEdit: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="py-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[#26323A]">{label}</p>
          {editing ? (
            <input
              type={inputType}
              inputMode={inputMode}
              value={editValue}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl border border-[#D9E0E4] bg-white px-4 text-[15px] text-[#26323A] outline-none focus:border-[#2F8FB3]"
              suppressHydrationWarning
            />
          ) : (
            <p className="mt-1 break-words text-[15px] leading-6 text-[#7A838A]">{value}</p>
          )}
        </div>
        {editing ? (
          <button type="button" onClick={onSave} disabled={saving} className="pt-0.5 text-sm font-semibold text-[#17624F] underline-offset-2 hover:underline disabled:opacity-60">
            {saving ? "Saving" : "Save"}
          </button>
        ) : (
          <button type="button" onClick={onEdit} className="pt-0.5 text-sm font-semibold text-[#26323A] underline underline-offset-2">
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

const avatarCropWorkspaceSize = 420;
const avatarCropCircleSize = 256;
const avatarCropOutputSize = 512;

function cropAvatarImage(source: string, scale: number, offset: { x: number; y: number }) {
  return new Promise<string>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = avatarCropOutputSize;
      canvas.height = avatarCropOutputSize;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas not available"));
        return;
      }

      const fitScale = Math.min(avatarCropWorkspaceSize / image.naturalWidth, avatarCropWorkspaceSize / image.naturalHeight);
      const totalScale = fitScale * scale;
      const displayWidth = image.naturalWidth * totalScale;
      const displayHeight = image.naturalHeight * totalScale;
      const imageLeft = avatarCropWorkspaceSize / 2 - displayWidth / 2 + offset.x;
      const imageTop = avatarCropWorkspaceSize / 2 - displayHeight / 2 + offset.y;
      const cropLeft = (avatarCropWorkspaceSize - avatarCropCircleSize) / 2;
      const cropTop = (avatarCropWorkspaceSize - avatarCropCircleSize) / 2;
      const sourceX = (cropLeft - imageLeft) / totalScale;
      const sourceY = (cropTop - imageTop) / totalScale;
      const sourceSize = avatarCropCircleSize / totalScale;

      context.fillStyle = "#F2F4F5";
      context.fillRect(0, 0, avatarCropOutputSize, avatarCropOutputSize);
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, avatarCropOutputSize, avatarCropOutputSize);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = source;
  });
}

function EditProfilePhotoPanel({
  previewUrl,
  name,
  scale,
  offset,
  saving,
  fileInputRef,
  onBack,
  onScaleChange,
  onOffsetChange,
  onFileChange,
  onConfirm,
}: {
  previewUrl: string;
  name: string;
  scale: number;
  offset: { x: number; y: number };
  saving: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onScaleChange: (nextScale: number) => void;
  onOffsetChange: (nextOffset: { x: number; y: number }) => void;
  onFileChange: (file: File | null) => void;
  onConfirm: () => void;
}) {
  const [dragState, setDragState] = useState<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!previewUrl) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    });
  }

  function dragPhoto(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    onOffsetChange({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragState?.pointerId === event.pointerId) {
      setDragState(null);
    }
  }

  function zoomPhoto(event: ReactWheelEvent<HTMLDivElement>) {
    if (!previewUrl) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    onScaleChange(Math.min(2.5, Math.max(0.6, Number((scale + delta).toFixed(2)))));
  }

  function resetPhoto() {
    onScaleChange(1);
    onOffsetChange({ x: 0, y: 0 });
  }

  return (
    <section className="-mx-5 min-h-[calc(100vh-140px)] bg-[var(--workspace)] px-5 pb-8 pt-1">
      <header className="flex h-14 items-center justify-between">
        <button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center text-[#26323A]" aria-label="Back">
          <BackArrowIcon />
        </button>
        <h1 className="text-base font-semibold text-[#26323A]">Preview</h1>
        <span className="h-10 w-10" aria-hidden />
      </header>

      <div className="mt-5 rounded-[28px] bg-[#F2F3F3] px-4 py-8 md:px-8">
        <div
          className={cn(
            "relative mx-auto flex h-[420px] w-full max-w-[420px] items-center justify-center overflow-hidden rounded-[28px] bg-[#EEF0F0]",
            previewUrl && "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          onPointerDown={beginDrag}
          onPointerMove={dragPhoto}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={zoomPhoto}
        >
          {previewUrl ? (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] bg-contain bg-center bg-no-repeat will-change-transform"
              style={{
                backgroundImage: `url("${previewUrl}")`,
                transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              }}
              aria-hidden
            />
          ) : (
            <span className="text-5xl font-semibold text-[#17624F]">{initials(name)}</span>
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle 128px at center, transparent 0 126px, rgba(242, 243, 243, 0.74) 127px, rgba(242, 243, 243, 0.86) 100%)",
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_22px_48px_rgba(38,50,58,0.18)]"
            aria-hidden
          />
        </div>
      </div>

      <div className="mx-auto -mt-8 flex w-fit items-center overflow-hidden rounded-full bg-white shadow-[0_14px_30px_rgba(38,50,58,0.14)] ring-1 ring-[#E4EAEE]">
        <button type="button" onClick={() => onScaleChange(Math.max(0.6, Number((scale - 0.1).toFixed(1))))} className="flex h-12 w-14 items-center justify-center text-2xl text-[#26323A]" aria-label="Zoom out">
          -
        </button>
        <button type="button" onClick={() => onScaleChange(Math.min(2.5, Number((scale + 0.1).toFixed(1))))} className="flex h-12 w-14 items-center justify-center border-l border-[#E4EAEE] text-2xl text-[#26323A]" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={resetPhoto} className="h-12 border-l border-[#E4EAEE] px-6 text-sm font-semibold text-[#26323A]">
          Reset
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
      <div className="mt-9 space-y-4">
        <button type="button" onClick={() => fileInputRef.current?.click()} className="min-h-12 w-full rounded-full bg-[#F2F4F5] px-5 text-sm font-semibold text-[#26323A]">
          Select another photo
        </button>
        <button type="button" onClick={onConfirm} disabled={saving} className="min-h-12 w-full rounded-full bg-[#171717] px-5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "Saving..." : "Confirm"}
        </button>
      </div>
    </section>
  );
}

function AccountSwitchPanel({
  accounts,
  busy,
  busyEmail,
  message,
  onSwitch,
}: {
  accounts: DevSwitchAccount[];
  busy: boolean;
  busyEmail: string | null;
  message: string | null;
  onSwitch: (account: DevSwitchAccount) => void;
}) {
  const [selectedEmail, setSelectedEmail] = useState(accounts[0]?.email ?? "");
  const selectedAccount = accounts.find((account) => account.email === selectedEmail) ?? accounts[0] ?? null;
  const selectedValue = selectedAccount?.email ?? "";

  return (
    <section className="mt-8">
      <p className="text-sm leading-6 text-[#6B747B]">Temporary development switcher. Choose any local account and sign in immediately.</p>

      <div className="mt-7 rounded-[28px] bg-white p-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
        {accounts.length ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-[#26323A]">Account</span>
              <select
                value={selectedValue}
                onChange={(event) => setSelectedEmail(event.target.value)}
                disabled={busy}
                className="mt-2 h-12 w-full rounded-[8px] border border-[#B9C3C8] bg-white px-3 text-sm font-semibold text-[#26323A] outline-none focus:border-[#2F8FB3]"
              >
                {accounts.map((account) => (
                  <option key={`${account.id ?? account.accountType}-${account.email}`} value={account.email}>
                    {account.label} - {titleCase(account.accountType)} - {account.email}
                  </option>
                ))}
              </select>
            </label>

            {selectedAccount ? (
              <div className="rounded-[18px] bg-[#F7FBFC] px-4 py-3">
                <p className="font-semibold text-[#26323A]">{selectedAccount.label}</p>
                <p className="mt-1 text-sm text-[#6B747B]">{selectedAccount.email}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#17624F]">{selectedAccount.accountType}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => selectedAccount && onSwitch(selectedAccount)}
              disabled={busy || !selectedAccount}
              className="min-h-11 w-full rounded-[8px] bg-[#17624F] px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy && selectedAccount && busyEmail === selectedAccount.email ? "Switching..." : "Switch account"}
            </button>
          </div>
        ) : null}
        {!accounts.length ? <p className="px-5 py-6 text-sm leading-6 text-[#6B747B]">No test accounts are configured.</p> : null}
      </div>

      <div className="mt-5 space-y-3">
        <p className="text-xs leading-5 text-[#8A949B]">Loaded from app profiles in development. Password-based fallback accounts still use <span className="font-semibold text-[#26323A]">NEXT_PUBLIC_DEV_SWITCH_ACCOUNTS</span>.</p>
        {message ? <p className="rounded-2xl bg-[#FCEDEC] px-4 py-3 text-sm leading-6 text-[#8F2D23]">{message}</p> : null}
      </div>
    </section>
  );
}

function AccountDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#7B858C]">{label}</dt>
      <dd className="mt-1 break-words text-[15px] font-semibold leading-6 text-[#26323A]">{value}</dd>
    </div>
  );
}

function StaticAccountNote({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
      <h2 className="text-base font-semibold text-[#26323A]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#6B747B]">{text}</p>
    </section>
  );
}

function AccountUserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c1.1-3.5 3.3-5.3 6.5-5.3s5.4 1.8 6.5 5.3" />
    </svg>
  );
}

function FamilyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3" />
      <path d="M20 20v-1.2a3.2 3.2 0 0 0-2.4-3.1" />
      <path d="M15.6 5.2a3 3 0 0 1 0 5.6" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 5 6v5.2c0 4.3 2.8 7.8 7 9.8 4.2-2 7-5.5 7-9.8V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.5-4" />
    </svg>
  );
}

function HomeScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18h2" />
      <path d="M12 7v7" />
      <path d="m9.5 9.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 17 15 12l-5-5" />
      <path d="M15 12H3" />
      <path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" />
    </svg>
  );
}

function SwitchAccountIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 3h3v3" />
      <path d="M8 21H5v-3" />
      <path d="M19 6a7.5 7.5 0 0 0-12.7-1.9L5 5.4" />
      <path d="M5 18a7.5 7.5 0 0 0 12.7 1.9l1.3-1.3" />
      <circle cx="12" cy="9" r="2.7" />
      <path d="M7.8 15.5c.8-2 2.2-3 4.2-3s3.4 1 4.2 3" />
    </svg>
  );
}

function ChevronRightIcon({ className = "text-[#9AA4AA]" }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h11" />
    </svg>
  );
}

function Logo({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={48} height={48} className="h-12 w-12 shrink-0 border border-[#D6DCE0] object-contain" />;
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-[#D6DCE0] bg-[#F7F8F9] text-sm font-medium text-[#2F8FB3]">
      {initials(name)}
    </div>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={42} height={42} className="h-11 w-11 shrink-0 rounded-full object-cover" />;
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E7F3F8] text-sm font-medium text-[#2F8FB3]">
      {initials(name)}
    </div>
  );
}

function DirectorySkeleton() {
  return <GenericLoadingState label="Loading" />;
}

function ProgramDetailLoadingState() {
  return <GenericLoadingState label="Loading class" />;
}

function ClassesLoadingPlaceholders({ count = 2 }: { count?: number }) {
  void count;
  return <GenericLoadingState label="Loading classes" />;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function lastNameOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "").toLowerCase();
}

function displayAge(profile: Pick<Profile, "date_of_birth" | "age"> | null | undefined) {
  const calculatedAge = calculateAge(profile?.date_of_birth ?? null);
  if (calculatedAge !== null) {
    return `${calculatedAge}`;
  }
  return profile?.age?.trim() || "Not provided";
}

function formatMemberDate(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function calculateAge(dateOfBirth: string | null) {
  if (!dateOfBirth) {
    return null;
  }
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function profileAgeNumber(profile: Pick<Profile, "date_of_birth" | "age"> | null | undefined) {
  const calculatedAge = calculateAge(profile?.date_of_birth ?? null);
  if (calculatedAge !== null) {
    return calculatedAge;
  }

  const parsedAge = Number.parseInt(profile?.age ?? "", 10);
  return Number.isFinite(parsedAge) ? parsedAge : null;
}

function isProfileEligibleForProgram(profile: Pick<Profile, "date_of_birth" | "age" | "gender"> | null | undefined, program: Pick<Program, "age_range_text" | "audience_gender">) {
  const ageBounds = parseAgeRange(program.age_range_text);
  if (ageBounds) {
    const age = profileAgeNumber(profile);
    if (age === null) {
      return { eligible: false, reason: "Missing age requirement for this class." };
    }
    if (ageBounds.min !== null && age < ageBounds.min) {
      return { eligible: false, reason: `Outside age range: must be ${ageBounds.min} or older.` };
    }
    if (ageBounds.max !== null && age > ageBounds.max) {
      return { eligible: false, reason: `Outside age range: must be ${ageBounds.max} or younger.` };
    }
  }

  const audience = formatGender(program.audience_gender);
  const gender = normalizeGender(profile?.gender ?? null);
  if (audience === "Brothers Only" && gender !== "male") {
    return { eligible: false, reason: "Audience requirement: brothers only." };
  }
  if (audience === "Sisters Only" && gender !== "female") {
    return { eligible: false, reason: "Audience requirement: sisters only." };
  }

  return { eligible: true, reason: null };
}

function parseAgeRange(ageRange: string | null) {
  const normalized = ageRange?.trim().toLowerCase();
  if (!normalized || normalized === "all" || normalized === "all ages") {
    return null;
  }

  const cleaned = normalized.replace(/^ages?\s*/, "");
  const rangeMatch = cleaned.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  }

  const plusMatch = cleaned.match(/^(\d+)\s*\+$/);
  if (plusMatch) {
    return { min: Number(plusMatch[1]), max: null };
  }

  const exactMatch = cleaned.match(/^(\d+)$/);
  if (exactMatch) {
    const age = Number(exactMatch[1]);
    return { min: age, max: age };
  }

  return null;
}

function normalizeGender(gender: string | null) {
  const normalized = gender?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["male", "boy", "boys", "brother", "brothers"].includes(normalized)) {
    return "male";
  }
  if (["female", "girl", "girls", "sister", "sisters"].includes(normalized)) {
    return "female";
  }
  return normalized;
}

function formatPrice(cents: number | null) {
  if (!cents) {
    return "Free";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getWhatsAppHref(phoneNumber: string | null | undefined) {
  const trimmed = phoneNumber?.trim();
  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  return digits ? `https://wa.me/${digits}` : null;
}

function formatAgeRange(ageRange: string | null) {
  if (!ageRange) {
    return "All ages";
  }

  const trimmed = ageRange.trim();
  return trimmed.toLowerCase() === "all" ? "All ages" : trimmed;
}

function validateAccountPassword(value: string) {
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return "Password must include uppercase, lowercase, number, and symbol.";
  }
  return null;
}

function formatGender(gender: string | null) {
  if (!gender) {
    return "Brothers & Sisters";
  }

  const trimmed = gender.trim();
  const normalized = trimmed.toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "all" || normalized === "all genders" || normalized === "all students" || normalized === "mixed") {
    return "Brothers & Sisters";
  }
  if (normalized === "male" || normalized === "boys" || normalized === "brothers" || normalized === "brothers only") {
    return "Brothers Only";
  }
  if (normalized === "female" || normalized === "girls" || normalized === "sisters" || normalized === "sisters only") {
    return "Sisters Only";
  }

  return trimmed;
}

function formatStudentDetailGender(gender: string | null) {
  if (!gender) {
    return "Not provided";
  }

  const trimmed = gender.trim();
  const normalized = trimmed.toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "male" || normalized === "boys" || normalized === "brothers" || normalized === "brothers only") {
    return "Brother";
  }
  if (normalized === "female" || normalized === "girls" || normalized === "sisters" || normalized === "sisters only") {
    return "Sister";
  }

  return trimmed;
}

function timeAgo(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function parseProgramSchedule(schedule: Json | null): ProgramScheduleRow[] {
  const rawRows = expandRawScheduleRows(schedule);
  if (rawRows.length === 0) {
    return [];
  }

  const rows = rawRows
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const dayValue = readScheduleString(item, ["day", "weekday", "days"]);
      const startValue = readScheduleString(item, ["start", "start_time", "startTime", "from"]);
      const endValue = readScheduleString(item, ["end", "end_time", "endTime", "to"]);
      const day = dayValue ? normalizeScheduleDay(dayValue) : "";
      const start = startValue ? normalizeScheduleTime(startValue) : "";
      const end = endValue ? normalizeScheduleTime(endValue) : "";
      if (!day || !start) {
        return null;
      }

      return { day, start, end: end || start };
    })
    .filter((row): row is ProgramScheduleRow => Boolean(row));

  return sortScheduleRows(rows);
}

function expandRawScheduleRows(schedule: Json | null): Array<Record<string, Json>> {
  if (Array.isArray(schedule)) {
    return schedule.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }

      return expandScheduleObject(item as Record<string, Json>);
    });
  }

  if (schedule && typeof schedule === "object") {
    return expandScheduleObject(schedule as Record<string, Json>);
  }

  return [];
}

function expandScheduleObject(item: Record<string, Json>): Array<Record<string, Json>> {
  const days = item.days;
  if (Array.isArray(days)) {
    return days
      .filter((day): day is string => typeof day === "string")
      .map((day) => ({
        ...item,
        day,
      }));
  }

  return [item];
}

function readScheduleString(item: Record<string, Json>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function sortScheduleRows(rows: ProgramScheduleRow[]) {
  return [...rows].sort((a, b) => scheduleDayOptions.indexOf(a.day as (typeof scheduleDayOptions)[number]) - scheduleDayOptions.indexOf(b.day as (typeof scheduleDayOptions)[number]));
}

function normalizeScheduleDay(value: string) {
  const lower = value.trim().toLowerCase();
  const found = scheduleDayOptions.find((day) => day.toLowerCase() === lower || day.slice(0, 3).toLowerCase() === lower.slice(0, 3));
  return found ?? "";
}

function normalizeScheduleTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return "";
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatClockLabel(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }

  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatScheduleRange(start: string, end?: string | null) {
  const startLabel = formatClockLabel(start);
  const endLabel = end ? formatClockLabel(end) : "";
  return endLabel ? `${startLabel}-${endLabel}` : startLabel;
}

function scheduleLabel(schedule: Json | null, fallback: string) {
  const rows = parseProgramSchedule(schedule);
  if (rows.length === 0) {
    return fallback;
  }

  return rows.length === 1 ? rows[0].day : rows.map((row) => row.day.slice(0, 3)).join(", ");
}

function scheduleTime(schedule: Json | null) {
  const rows = parseProgramSchedule(schedule);
  if (rows.length === 0) {
    return "TBA";
  }

  const firstTime = `${rows[0].start}-${rows[0].end}`;
  return rows.every((row) => `${row.start}-${row.end}` === firstTime) ? formatScheduleRange(rows[0].start, rows[0].end) : "Multiple times";
}

function scheduleSummary(schedule: Json | null, notes: string | null) {
  const day = scheduleLabel(schedule, "Schedule TBA");
  const time = scheduleTime(schedule);
  const full = notes || (time === "TBA" ? day : `${day}, ${time}`);
  return { day, time, full };
}

function mockProgramDescription(title: string) {
  return `${title} is designed to help students build steady progress through clear instruction, guided practice, and consistent class routines.`;
}

function mockTeacherCredentials(title: string) {
  return `Certified instructor with experience teaching ${title.toLowerCase()} in a masjid classroom setting. Credentials and ijazah details can be updated from the teacher profile in Supabase.`;
}
