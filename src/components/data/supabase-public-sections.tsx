"use client";

import Image from "next/image";
import Link from "next/link";
import { ChildrenManager } from "@/components/data/children-manager";
import { TransitionLink } from "@/components/layout/transition-link";
import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
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
type ProgramContentSection = Database["public"]["Tables"]["program_content_sections"]["Row"];
type ProgramMedia = Database["public"]["Tables"]["program_media"]["Row"];
type Enrollment = Database["public"]["Tables"]["enrollments"]["Row"];
type EnrollmentRequest = Database["public"]["Tables"]["enrollment_requests"]["Row"];
type AnnouncementReceipt = Database["public"]["Tables"]["program_announcement_receipts"]["Row"];
type ProgramSessionCancellation = Database["public"]["Tables"]["program_session_cancellations"]["Row"];
type TeacherDisplay = Pick<Profile, "id" | "full_name" | "avatar_url" | "teacher_credentials" | "teacher_whatsapp_number">;
type StudentDisplay = Pick<Profile, "id" | "full_name" | "email" | "phone_number" | "avatar_url" | "age" | "gender" | "date_of_birth">;
type ParentDisplay = Pick<Profile, "id" | "full_name" | "email" | "phone_number" | "avatar_url">;

type ProgramWithTeacher = Program & {
  teacher?: TeacherDisplay | null;
};

type AnnouncementWithContext = Database["public"]["Tables"]["program_announcements"]["Row"] & {
  program?: Program | null;
  author?: Profile | null;
  receipt?: AnnouncementReceipt | null;
};

type RequestWithContext = EnrollmentRequest & {
  program?: Program | null;
  student?: StudentDisplay | null;
  parent?: ParentDisplay | null;
};

type ProgramScheduleRow = {
  day: (typeof scheduleDayOptions)[number];
  start: string;
  end: string;
};

type MosqueProgramsSnapshot = {
  mosque: Mosque;
  programs: ProgramWithTeacher[];
};

type NotificationCounts = {
  announcementCount: number;
  requestCount: number;
};

const mosqueProgramsCache = new Map<string, MosqueProgramsSnapshot>();
const mosqueProgramsPromises = new Map<string, Promise<MosqueProgramsSnapshot>>();
const notificationCountsCache = new Map<string, NotificationCounts>();

type DevSwitchAccount = {
  label: string;
  email: string;
  password: string;
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
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
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

function saveDevSwitchAccount(account: DevSwitchAccount) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return;
  }

  const current = readStoredDevSwitchAccounts();
  const next = [account, ...current.filter((saved) => saved.email.toLowerCase() !== account.email.toLowerCase())].slice(0, 12);
  window.localStorage.setItem(devSwitchAccountsStorageKey, JSON.stringify(next));
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
  const { programs, enrolledProgramIds, programOwnerLabels, loading, enrollmentLoading, error } = useStudentPrograms(slug);
  const { unreadCount } = useStudentUnreadAnnouncements(slug);

  if (loading || enrollmentLoading) {
    return <HomeLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load masjid" text={error} />;
  }

  const enrolledPrograms = programs.filter((program) => enrolledProgramIds.includes(program.id));

  return (
    <section className="space-y-5 bg-[var(--workspace)] p-4">
      <HomeNotification
        tone={unreadCount > 0 ? "active" : "empty"}
        title={unreadCount > 0 ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}` : "No new inbox items"}
        text={unreadCount > 0 ? "Class announcements are waiting in your inbox." : "New announcements/updates will appear here."}
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
  const [mediaItems, setMediaItems] = useState<ProgramMedia[]>([]);
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
      if (programData?.teacher_profile_id) {
        const { data: teacherData } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, teacher_credentials, teacher_whatsapp_number")
          .eq("id", programData.teacher_profile_id)
          .maybeSingle();
        teacher = teacherData ?? null;
      }

      if (programData) {
        const [detailsResult, outcomesResult, contentResult, mediaResult] = await Promise.all([
          supabase.from("program_details").select("*").eq("program_id", programData.id).maybeSingle(),
          supabase.from("program_outcomes").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_content_sections").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
          supabase.from("program_media").select("*").eq("program_id", programData.id).order("sort_order", { ascending: true }),
        ]);

        setDetails(detailsResult.data ?? null);
        setOutcomes(outcomesResult.data ?? []);
        setContentSections(contentResult.data ?? []);
        setMediaItems(mediaResult.data ?? []);

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
          setIsStaffForProgram(Boolean(teacherAssignmentResult.data) || programData.teacher_profile_id === userId || access.isMosqueAdmin);

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

  const teacherName = program.teacher?.full_name ?? "Teacher to be announced";
  const isTeacherContext = section === "teacher";
  const teacherCredentials = program.teacher?.teacher_credentials?.trim() || mockTeacherCredentials(program.title);
  const teacherWhatsAppHref = getWhatsAppHref(program.teacher?.teacher_whatsapp_number);
  const age = formatAgeRange(program.age_range_text);
  const gender = formatGender(program.audience_gender);
  const price = formatPrice(program.price_monthly_cents);
  const schedule = scheduleSummary(program.schedule, program.schedule_notes);
  const learningIntro = details?.learning_intro?.trim() ?? "";
  const learningOutcomes = outcomes.map((item) => item.text);
  const hasLearningSection = Boolean(learningIntro) || learningOutcomes.length > 0;
  const classContent = contentSections;
  const hasContentSection = classContent.length > 0;
  const galleryItems = mediaItems;
  const hasMediaSection = galleryItems.length > 0;
  const selfEligibility = accountType === "student" ? isProfileEligibleForProgram(selfProfile, program) : { eligible: true, reason: null };

  async function requestEnrollment() {
    if (!currentUserId || !mosque || !program) {
      return;
    }

    setRequestBusy(true);
    setRequestMessage(null);
    const supabase = createSupabaseBrowserClient();
    if (accountType === "parent") {
      const requestableChildIds = selectedChildIds.filter((childId) => {
        const status = childStatuses[childId];
        const child = parentChildren.find((item) => item.id === childId);
        return Boolean(child) && isProfileEligibleForProgram(child, program).eligible && !status?.enrolled && status?.requestStatus !== "pending";
      });

      if (requestableChildIds.length === 0) {
        setRequestMessage("Select at least one eligible child who is not already enrolled or pending review.");
        setRequestBusy(false);
        return;
      }

      const { data: parentRequestRows, error: parentInsertError } = await supabase
        .from("enrollment_requests")
        .upsert(
          requestableChildIds.map((childId) => ({
            mosque_id: mosque.id,
            program_id: program.id,
            student_profile_id: childId,
            parent_profile_id: currentUserId,
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            student_dismissed_at: null,
          })),
          { onConflict: "program_id,student_profile_id" },
        )
        .select("id");

      if (parentInsertError) {
        setRequestMessage(parentInsertError.message);
        setRequestBusy(false);
        return;
      }

      setChildStatuses((current) => {
        const next = { ...current };
        for (const childId of requestableChildIds) {
          next[childId] = { enrolled: false, requestStatus: "pending" };
        }
        return next;
      });
      setSelectedChildIds([]);
      setChildSelectorOpen(false);
      setRequestMessage(`${requestableChildIds.length} enrollment request${requestableChildIds.length === 1 ? "" : "s"} sent for review.`);
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
          student_profile_id: currentUserId,
          parent_profile_id: null,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
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

    setRequestStatus("pending");
    setRequestMessage("Your request has been sent and will be reviewed by the teacher.");
    queueEnrollmentRequestSubmittedEmails((requestRows ?? []).map((row) => row.id));
    setRequestBusy(false);
  }

  return (
    <div className="bg-[var(--workspace)] p-4">
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
              <DetailSection title="What You Will Learn">
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
              {isSignedIn ? (
                isTeacherContext || isStaffForProgram ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#EEF6F8] px-4 text-sm font-semibold text-[#2F6F83] ring-1 ring-[#CFE2E8]">
                    Teaching
                  </div>
                ) : accountType === "parent" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setChildSelectorOpen((value) => !value)}
                      disabled={parentChildren.length === 0}
                      className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#248B72] px-4 text-sm font-semibold !text-white shadow-[0_10px_22px_rgba(36,139,114,0.24)] transition-colors hover:bg-[#17624F] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Request Enrollment
                    </button>
                    {childSelectorOpen ? (
                      <ChildEnrollmentSelector
                        program={program}
                        childrenProfiles={parentChildren}
                        statuses={childStatuses}
                        selectedChildIds={selectedChildIds}
                        onToggle={(childId) =>
                          setSelectedChildIds((current) =>
                            current.includes(childId) ? current.filter((id) => id !== childId) : [...current, childId],
                          )
                        }
                        onSubmit={requestEnrollment}
                        busy={requestBusy}
                      />
                    ) : parentChildren.length === 0 ? (
                      <p className="mt-3 rounded-xl bg-[#FFF7E6] p-3 text-sm leading-6 text-[#8A5A00]">Add children in Family settings before requesting enrollment.</p>
                    ) : null}
                  </>
                ) : isEnrolled ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#E8F7F2] px-4 text-sm font-semibold text-[#17624F] ring-1 ring-[#B9E4D7]">
                    Enrolled
                  </div>
                ) : requestStatus === "pending" ? (
                  <div className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-[#FFF7E6] px-4 text-sm font-semibold text-[#8A5A00] ring-1 ring-[#F3D28A]">
                    Pending Review
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
                <div className="mt-3 rounded-xl border border-[#B9E4D7] bg-[#F0FBF7] p-3 text-sm leading-6 text-[#17624F]">
                  <p>{requestMessage}</p>
                  {requestStatus === "pending" ? (
                    <Link href={`/m/${slug}/portal/announcements`} className="mt-1 inline-flex font-semibold text-[#17624F] underline">
                      Check inbox
                    </Link>
                  ) : null}
                </div>
              ) : null}

              <dl className="mt-5 divide-y divide-[#E6ECEF] text-sm">
                <SidebarFact label="Age" value={age} />
                <SidebarFact label="Audience" value={gender} />
                <SidebarFact label="Schedule" value={schedule.full} />
                <SidebarFact label="Teacher" value={teacherName} />
                <SidebarFact label="Status" value={program.is_active ? "Open" : "Closed"} />
              </dl>
            </aside>

            <DetailSection title="Instructor">
              <div className="flex items-center gap-4">
                <Avatar src={program.teacher?.avatar_url ?? null} name={teacherName} />
                <div>
                  <h2 className="text-base font-semibold text-[#26323A]">{teacherName}</h2>
                  <p className="mt-1 text-sm text-[#6B747B]">Program instructor</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-[#52616A]">{teacherCredentials}</p>
              <div className="mt-5 flex justify-center">
                {teacherWhatsAppHref ? (
                  <a
                    href={teacherWhatsAppHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-[#17624F] px-5 text-sm font-semibold !text-white shadow-[0_10px_20px_rgba(23,98,79,0.18)] ring-1 ring-[#0F4537]/20 transition-colors hover:bg-[#0F4537]"
                    style={{ color: "#fff" }}
                  >
                    <MessageIcon className="text-white" style={{ color: "#fff" }} />
                    <span className="!text-white" style={{ color: "#fff" }}>
                      Contact
                    </span>
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-lg bg-[#E8EEF2] px-5 text-sm font-semibold text-[#6B747B] ring-1 ring-[#D6E0E4]">
                    <MessageIcon />
                    Contact unavailable
                  </span>
                )}
              </div>
            </DetailSection>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentClassesData({ slug }: { slug: string }) {
  const { mosque, programs, enrolledProgramIds, loading, enrollmentLoading, error } = useStudentPrograms(slug);
  const [tab, setTab] = useState<"enrolled" | "browse">("enrolled");

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
      <div className="grid grid-cols-2 border-b border-[#D6DCE0]">
        <button
          type="button"
          onClick={() => setTab("enrolled")}
          className={cn("min-h-12 text-sm font-medium", tab === "enrolled" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          Enrolled
        </button>
        <button
          type="button"
          onClick={() => setTab("browse")}
          className={cn("min-h-12 text-sm font-medium", tab === "browse" ? "border-b-2 border-[#2F8FB3] text-[#2F8FB3]" : "text-[#6B747B]")}
        >
          Browse
        </button>
      </div>

      {content}
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
  const [loading, setLoading] = useState(true);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const canUseAccountSwitcher = process.env.NODE_ENV !== "production";
  const devSwitchAccounts = canUseAccountSwitcher ? getDevSwitchAccounts() : [];

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
    const { error } = await createSupabaseBrowserClient()
      .from("profiles")
      .update({
        avatar_url: cleanedAvatarUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      setProfileMessage(error.message);
      setProfileSaving(false);
      return;
    }

    setProfile((current) => (current ? { ...current, avatar_url: cleanedAvatarUrl || null } : current));
    setProfileForm((current) => ({ ...current, avatarUrl: cleanedAvatarUrl }));
    setCachedProfileSummary(profile.id, {
      fullName: profile.full_name?.trim() || null,
      avatarUrl: cleanedAvatarUrl || null,
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
        if (nextPassword.length < 6) {
          setProfileMessage("Password must be at least 6 characters.");
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
        await supabase.from("profiles").update({ email: nextEmail, updated_at: new Date().toISOString() }).eq("id", profile.id);
        setSessionEmail(nextEmail);
        setProfile((current) => (current ? { ...current, email: nextEmail } : current));
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

      const { error } = await supabase.from("profiles").update(updates).eq("id", profile.id);
      if (error) {
        setProfileMessage(error.message);
        setProfileSaving(false);
        return;
      }

      setProfile((current) =>
        current
          ? {
              ...current,
              ...(field === "fullName" ? { full_name: profileForm.fullName.trim() || null } : {}),
              ...(field === "phone" ? { phone_number: profileForm.phone.trim() || null } : {}),
              ...(field === "dateOfBirth" ? { date_of_birth: profileForm.dateOfBirth || null } : {}),
            }
          : current,
      );

      if (field === "fullName") {
        setCachedProfileName(profile.id, profileForm.fullName.trim() || null);
        setCachedProfileSummary(profile.id, {
          fullName: profileForm.fullName.trim() || null,
          avatarUrl: profile.avatar_url?.trim() || null,
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
    return (
      <div className="min-h-[calc(100vh-140px)] bg-[var(--workspace)] px-5 py-8">
        <div className="mx-auto max-w-sm space-y-4">
          <div className="mx-auto h-28 w-28 rounded-full bg-[var(--placeholder)]" />
          <div className="mx-auto h-6 w-40 rounded-full bg-[var(--placeholder)]" />
          <div className="mx-auto h-4 w-28 rounded-full bg-[var(--placeholder)]" />
          <div className="mt-8 space-y-3">
            <div className="h-16 rounded-2xl bg-[#fffdf8]" />
            <div className="h-16 rounded-2xl bg-[#fffdf8]" />
            <div className="h-16 rounded-2xl bg-[#fffdf8]" />
          </div>
        </div>
      </div>
    );
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
  const [requests, setRequests] = useState<RequestWithContext[]>([]);
  const [tab, setTab] = useState<"announcements" | "requests">("announcements");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<"success" | "cancelled" | null>(null);
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setRequests([]);
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

    const [{ data: enrollments }, { data: requestRows, error: requestError }] = await Promise.all([
      targetStudentIds.length
        ? supabase.from("enrollments").select("program_id, student_profile_id").in("student_profile_id", targetStudentIds)
        : Promise.resolve({ data: [] as Array<{ program_id: string; student_profile_id: string }> }),
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
    ]);

    if (requestError) {
      setLoading(false);
      setError(requestError.message);
      return;
    }

    const enrolledProgramIds = (enrollments ?? []).map((enrollment) => enrollment.program_id);
    const requestProgramIds = (requestRows ?? []).map((request) => request.program_id);
    const knownProgramIds = Array.from(new Set([...enrolledProgramIds, ...requestProgramIds]));
    const requestStudentIds = Array.from(new Set((requestRows ?? []).map((request) => request.student_profile_id)));
    const [{ data: programs }, { data: requestStudents }] = await Promise.all([
      knownProgramIds.length ? supabase.from("programs").select("*").in("id", knownProgramIds) : Promise.resolve({ data: [] as Program[] }),
      requestStudentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth").in("id", requestStudentIds)
        : Promise.resolve({ data: [] as StudentDisplay[] }),
    ]);
    const childProfiles = isParent ? children : ((requestStudents ?? []) as StudentDisplay[]);

    setRequests(
      (requestRows ?? []).map((request) => ({
        ...request,
        program: (programs ?? []).find((program) => program.id === request.program_id) ?? null,
        student: childProfiles.find((student) => student.id === request.student_profile_id) ?? null,
      })),
    );

    if (enrolledProgramIds.length === 0) {
      setAnnouncements([]);
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("program_announcements")
      .select("*")
      .in("program_id", enrolledProgramIds)
      .order("created_at", { ascending: false })
      .limit(50);
    if (queryError) {
      setLoading(false);
      setError(queryError.message);
      return;
    }

    const announcementIds = (data ?? []).map((announcement) => announcement.id);
    const authorIds = Array.from(new Set((data ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean)));
    const [{ data: authors }, { data: receipts }] = await Promise.all([
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
      announcementIds.length
        ? supabase.from("program_announcement_receipts").select("*").eq("profile_id", userId).in("announcement_id", announcementIds)
        : Promise.resolve({ data: [] as AnnouncementReceipt[] }),
    ]);

    const visibleAnnouncements = (data ?? [])
      .map((announcement) => ({
        ...announcement,
        program: (programs ?? []).find((program) => program.id === announcement.program_id) ?? null,
        author: (authors ?? []).find((author) => author.id === announcement.author_profile_id) ?? null,
        receipt: (receipts ?? []).find((receipt) => receipt.announcement_id === announcement.id) ?? null,
      }))
      .filter((announcement) => !announcement.receipt?.dismissed_at);

    const unreadAnnouncements = visibleAnnouncements.filter((announcement) => !announcement.receipt?.read_at);
    if (unreadAnnouncements.length > 0) {
      const now = new Date().toISOString();
      await supabase.from("program_announcement_receipts").upsert(
        unreadAnnouncements.map((announcement) => ({
          announcement_id: announcement.id,
          profile_id: userId,
          read_at: now,
          dismissed_at: null,
          updated_at: now,
        })),
        { onConflict: "announcement_id,profile_id" },
      );
      window.dispatchEvent(new Event("tareeqah:notifications-changed"));
      setAnnouncements(
        visibleAnnouncements.map((announcement) =>
          unreadAnnouncements.some((unread) => unread.id === announcement.id)
            ? {
                ...announcement,
                receipt: {
                  id: announcement.receipt?.id ?? `local-${announcement.id}`,
                  announcement_id: announcement.id,
                  profile_id: userId,
                  read_at: now,
                  dismissed_at: null,
                  created_at: announcement.receipt?.created_at ?? now,
                  updated_at: now,
                },
              }
            : announcement,
        ),
      );
    } else {
      setAnnouncements(visibleAnnouncements);
    }
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInbox();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function updateRequest(requestId: string, action: "rescind" | "dismiss") {
    const supabase = createSupabaseBrowserClient();
    await supabase
      .from("enrollment_requests")
      .update(
        action === "rescind"
          ? { status: "cancelled", student_dismissed_at: new Date().toISOString() }
          : { student_dismissed_at: new Date().toISOString() },
      )
      .eq("id", requestId);
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadInbox();
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
  const unseenReturnedRequestCount = returnedRequests.filter((request) => !seenRequestIds.has(studentRequestNotificationKey(request))).length;
  const returnedRequestIdsKey = returnedRequests.map(studentRequestNotificationKey).join("|");

  useEffect(() => {
    if (!loading && tab === "requests" && returnedRequestIdsKey) {
      setSeenRequestIds(markNotificationIdsSeen(seenStudentRequestsStorageKey, currentUserId, returnedRequestIdsKey.split("|")));
    }
  }, [currentUserId, loading, returnedRequestIdsKey, tab]);

  function changeTab(nextTab: "announcements" | "requests") {
    setTab(nextTab);
    if (nextTab === "requests") {
      setSeenRequestIds(markNotificationIdsSeen(seenStudentRequestsStorageKey, currentUserId, returnedRequests.map(studentRequestNotificationKey)));
    }
  }

  return (
    <div className="bg-[var(--workspace)]">
      <SegmentedTabs
        tabs={[
          { id: "announcements", label: "Announcements" },
          { id: "requests", label: "Notifications", badge: unseenReturnedRequestCount },
        ]}
        value={tab}
        onChange={(value) => changeTab(value as "announcements" | "requests")}
      />
      <div className="space-y-4 p-4">
        {error ? (
          <EmptyState title="Could not load inbox" text={error} />
        ) : loading ? (
          <InboxLoadingPanel label={tab === "announcements" ? "Loading announcements" : "Loading requests"} />
        ) : tab === "announcements" ? (
          <StudentAnnouncementStream announcements={announcements} />
        ) : (
          <>
            <InboxSection title="Pending" count={pendingRequests.length}>
              {pendingRequests.length ? (
                pendingRequests.map((request) => (
                  <StudentRequestCard key={request.id} request={request} onRescind={() => updateRequest(request.id, "rescind")} />
                ))
              ) : (
                <MiniEmpty text="No pending requests." />
              )}
            </InboxSection>
            <InboxSection title="Returned" count={returnedRequests.length}>
              {returnedRequests.length ? (
                returnedRequests.map((request) => (
                  <StudentRequestCard
                    key={request.id}
                    request={request}
                    checkoutBusy={checkoutRequestId === request.id}
                    onCompleteRegistration={request.status === "approved" && request.program?.is_paid ? () => startCheckout(request.id) : undefined}
                    onDismiss={() => updateRequest(request.id, "dismiss")}
                  />
                ))
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
    </div>
  );
}

export function TeacherInboxData({ slug }: { slug: string }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  const [announcements, setAnnouncements] = useState<AnnouncementWithContext[]>([]);
  const [requests, setRequests] = useState<RequestWithContext[]>([]);
  const [tab, setTab] = useState<"announcements" | "requests">("announcements");
  const [message, setMessage] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTeacherInbox() {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setCurrentUserId(null);
      setSeenRequestIds(new Set());
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
      supabase.from("program_teachers").select("program_id").eq("teacher_profile_id", userId),
    ]);
    const assignedIds = new Set((assignments ?? []).map((assignment) => assignment.program_id));
    const teacherPrograms = (mosquePrograms ?? []).filter((program) => program.teacher_profile_id === userId || assignedIds.has(program.id));
    setPrograms(teacherPrograms);

    const activeProgramId = selectedProgramId || teacherPrograms[0]?.id || "";
    if (!selectedProgramId && activeProgramId) {
      setSelectedProgramId(activeProgramId);
    }

    const programIds = teacherPrograms.map((program) => program.id);
    if (programIds.length === 0) {
      setAnnouncements([]);
      setRequests([]);
      setLoading(false);
      return;
    }

    const [{ data: announcementRows, error: announcementError }, { data: requestRows, error: requestError }] = await Promise.all([
      activeProgramId
        ? supabase.from("program_announcements").select("*").eq("program_id", activeProgramId).order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as AnnouncementWithContext[], error: null }),
      supabase.from("enrollment_requests").select("*").in("program_id", programIds).order("requested_at", { ascending: false }),
    ]);

    if (announcementError || requestError) {
      setError(announcementError?.message ?? requestError?.message ?? "Could not load teacher inbox.");
      setLoading(false);
      return;
    }

    const studentIds = Array.from(new Set((requestRows ?? []).map((request) => request.student_profile_id)));
    const parentIds = Array.from(new Set((requestRows ?? []).map((request) => request.parent_profile_id).filter(Boolean))) as string[];
    const authorIds = Array.from(new Set((announcementRows ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean))) as string[];
    const [{ data: students }, { data: parents }, { data: authors }] = await Promise.all([
      studentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth").in("id", studentIds)
        : Promise.resolve({ data: [] as StudentDisplay[] }),
      parentIds.length
        ? supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url").in("id", parentIds)
        : Promise.resolve({ data: [] as ParentDisplay[] }),
      authorIds.length ? supabase.from("profiles").select("*").in("id", authorIds) : Promise.resolve({ data: [] as Profile[] }),
    ]);

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

    const supabase = createSupabaseBrowserClient();
    await supabase.from("program_announcements").insert({
      program_id: selectedProgramId,
      author_profile_id: currentUserId,
      message: message.trim(),
    });
    setMessage("");
    await loadTeacherInbox();
  }

  async function reviewRequest(request: RequestWithContext, status: "approved" | "rejected") {
    if (!currentUserId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: reviewError } = await supabase
      .from("enrollment_requests")
      .update({ status, reviewed_by: currentUserId, reviewed_at: new Date().toISOString() })
      .eq("id", request.id);

    if (reviewError) {
      setError(reviewError.message);
      return;
    }

    if (status === "approved" && !request.program?.is_paid) {
      await supabase.from("enrollments").upsert(
        {
          program_id: request.program_id,
          student_profile_id: request.student_profile_id,
        },
        { onConflict: "program_id,student_profile_id" },
      );
    }

    queueEnrollmentRequestReviewedEmail(request.id);
    window.dispatchEvent(new Event("tareeqah:notifications-changed"));
    await loadTeacherInbox();
  }

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const pastRequests = requests.filter((request) => request.status !== "pending");
  const unseenPendingRequestCount = pendingRequests.filter((request) => !seenRequestIds.has(request.id)).length;
  const selectedProgram = programs.find((program) => program.id === selectedProgramId);
  const pendingRequestIdsKey = pendingRequests.map((request) => request.id).join("|");

  useEffect(() => {
    if (!loading && tab === "requests" && pendingRequestIdsKey) {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, pendingRequestIdsKey.split("|")));
    }
  }, [currentUserId, loading, pendingRequestIdsKey, tab]);

  function changeTab(nextTab: "announcements" | "requests") {
    setTab(nextTab);
    if (nextTab === "requests") {
      setSeenRequestIds(markNotificationIdsSeen(seenTeacherRequestsStorageKey, currentUserId, pendingRequests.map((request) => request.id)));
    }
  }

  return (
    <div className="bg-[var(--workspace)]">
      <SegmentedTabs
        tabs={[
          { id: "announcements", label: "Announcements" },
          { id: "requests", label: "Requests", badge: unseenPendingRequestCount },
        ]}
        value={tab}
        onChange={(value) => changeTab(value as "announcements" | "requests")}
      />
      <div className="space-y-4 p-4">
        {error ? (
          <EmptyState title="Could not load teacher inbox" text={error} />
        ) : loading ? (
          <InboxLoadingPanel label={tab === "announcements" ? "Loading announcements" : "Loading requests"} />
        ) : tab === "announcements" ? (
          <section className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Class</label>
              <select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)} className="mt-2 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]">
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>{program.title}</option>
                ))}
              </select>
            </div>
            <div className="min-h-64 space-y-4">
              {announcements.length ? (
                announcements.map((announcement) => (
                  <TeacherAnnouncementBubble key={announcement.id} announcement={announcement} />
                ))
              ) : (
                <MiniEmpty text={selectedProgram ? "No announcements have been sent for this class." : "No assigned classes found."} />
              )}
            </div>
            <div>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Write an announcement..."
                className="min-h-24 w-full resize-none border border-[#B9C3C8] bg-white px-3 py-2 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
              />
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={sendAnnouncement} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#17624F] px-5 text-sm font-semibold text-white hover:bg-[#0F4537]">
                  Send
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <TeacherRequestSection title="Pending Requests" count={pendingRequests.length}>
              {pendingRequests.length ? (
                pendingRequests.map((request) => (
                  <TeacherRequestCard key={request.id} request={request} onAccept={() => reviewRequest(request, "approved")} onReject={() => reviewRequest(request, "rejected")} />
                ))
              ) : (
                <MiniEmpty text="No students are waiting for review." />
              )}
            </TeacherRequestSection>
            <TeacherRequestSection title="Past Requests" count={pastRequests.length}>
              {pastRequests.length ? (
                pastRequests.map((request) => (
                  <TeacherRequestCard key={request.id} request={request} reviewed />
                ))
              ) : (
                <MiniEmpty text="Reviewed requests will appear here." />
              )}
            </TeacherRequestSection>
          </>
        )}
      </div>
    </div>
  );
}

export function TeacherAnnouncementData({ slug, programId }: { slug: string; programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementWithContext[]>([]);
  const [message, setMessage] = useState("");
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

    const { data: announcementRows, error: announcementError } = await supabase
      .from("program_announcements")
      .select("*")
      .eq("program_id", programRow.id)
      .order("created_at", { ascending: true });

    if (announcementError) {
      setError(announcementError.message);
      setLoading(false);
      return;
    }

    const authorIds = Array.from(new Set((announcementRows ?? []).map((announcement) => announcement.author_profile_id).filter(Boolean))) as string[];
    const { data: authors } = authorIds.length
      ? await supabase.from("profiles").select("*").in("id", authorIds)
      : { data: [] as Profile[] };

    setProgram(programRow);
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

    const supabase = createSupabaseBrowserClient();
    const { error: insertError } = await supabase.from("program_announcements").insert({
      program_id: program.id,
      author_profile_id: currentUserId,
      message: message.trim(),
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("");
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
      <div className="max-h-72 min-h-64 space-y-4 overflow-y-auto pr-1">
        {announcements.length ? (
          announcements.map((announcement) => <TeacherAnnouncementBubble key={announcement.id} announcement={announcement} />)
        ) : (
          <MiniEmpty text="No announcements have been sent for this class." />
        )}
      </div>
      <div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write an announcement..."
          className="min-h-24 w-full resize-none border border-[#B9C3C8] bg-white px-3 py-2 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        />
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={sendAnnouncement} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#17624F] px-5 text-sm font-semibold text-white hover:bg-[#0F4537]">
            Send
          </button>
        </div>
      </div>
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
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [requestLoading, setRequestLoading] = useState(true);

  async function loadRequests() {
    if (!currentUserId || programs.length === 0) {
      setPendingRequestCount(0);
      setRequestLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const programIds = programs.map((program) => program.id);
    const { data: requestRows } = await supabase
            .from("enrollment_requests")
              .select("id, status, reviewed_at, requested_at")
      .in("program_id", programIds)
      .eq("status", "pending");

    setPendingRequestCount((requestRows ?? []).length);
    setRequestLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRequests();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, programs]);

  if (loading || requestLoading) {
    return <HomeLoadingState />;
  }

  if (error) {
    return <EmptyState title="Could not load teacher home" text={error} />;
  }

  return (
    <div className="space-y-4 bg-[var(--workspace)] p-4">
      <HomeNotification
        tone={pendingRequestCount > 0 ? "active" : "empty"}
        title={pendingRequestCount > 0 ? "Action required" : "No new inbox items"}
        text={pendingRequestCount > 0 ? `Check your inbox to review ${pendingRequestCount === 1 ? "the pending enrollment request" : `${pendingRequestCount} pending enrollment requests`}.` : "New enrollment requests and class messages will appear here."}
        href={pendingRequestCount > 0 ? `/m/${slug}/teacher/inbox` : undefined}
      />
      <HomeSectionTitle title="Upcoming" />
      {programs.length ? <HomeUpcomingRows programs={programs} canCancelSessions currentUserId={currentUserId} /> : <HomeEmptyState title="No assigned classes" text="Your next class sessions will appear here." />}
    </div>
  );
}

export function TeacherClassesData({ slug }: { slug: string }) {
  const { programs, loading, error } = useTeacherPrograms(slug);

  if (loading) {
    return <ClassesLoadingPlaceholders count={2} />;
  }

  if (error) {
    return <EmptyState title="Could not load classes" text={error} />;
  }

  if (programs.length === 0) {
    return <EmptyState title="No assigned classes" text="Classes assigned to your teacher account will appear here." />;
  }

  return (
    <div className="grid gap-4 bg-[var(--workspace)] p-4 md:grid-cols-2">
      {programs.map((program) => (
        <TeacherClassCard key={program.id} program={program} mosqueSlug={slug} />
      ))}
    </div>
  );
}

export function TeacherStudentsData({ slug, programId }: { slug: string; programId: string }) {
  const [mosque, setMosque] = useState<Mosque | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [students, setStudents] = useState<Array<{ enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<{ studentId: string; studentName: string } | null>(null);
  const [showKickMessage, setShowKickMessage] = useState(false);
  const [kickMessage, setKickMessage] = useState("");

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

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("*")
      .eq("program_id", programData.id)
      .order("created_at", { ascending: true });

    if (enrollmentError) {
      setError(enrollmentError.message);
      setLoading(false);
      return;
    }

    const studentIds = Array.from(new Set((enrollmentRows ?? []).map((enrollment) => enrollment.student_profile_id)));
    const { data: profileRows } = studentIds.length
      ? await supabase.from("profiles").select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth").in("id", studentIds)
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
    setStudents(
      (enrollmentRows ?? []).map((enrollment) => ({
        enrollment,
        profile: (profileRows ?? []).find((profile) => profile.id === enrollment.student_profile_id) ?? null,
        parent:
          ((parentRows ?? []).find(
            (parent) => parent.id === (linkRows ?? []).find((link) => link.child_profile_id === enrollment.student_profile_id)?.parent_profile_id,
          ) as ParentDisplay | undefined) ?? null,
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

  if (loading) {
    return <DirectorySkeleton />;
  }

  if (error && !program) {
    return <EmptyState title="Could not load students" text={error} />;
  }

  if (!program) {
    return <EmptyState title="Class not found" text="This teacher class could not be loaded." />;
  }

  const averageAttendance = students.length ? `${88 + (students.length % 8)}%` : "0%";

  return (
    <div className="bg-[var(--workspace)] p-4">
      <div className="space-y-5">
        <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
          <ProgramHero program={program} />
          <div className="space-y-3 p-4">
            <div>
              <h2 className="text-2xl font-semibold leading-8 text-[#26323A]">{program.title}</h2>
              <p className="mt-1 text-sm text-[#6B747B]">{scheduleSummary(program.schedule, program.schedule_notes).full}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <TeacherMetricTile icon={<StudentsIcon />} label="Students" value={String(students.length)} />
          <TeacherMetricTile icon={<AttendanceIcon />} label="Avg Attendance" value={averageAttendance} />
        </div>

        {error ? <div className="border-l-4 border-[#E25241] bg-[#FDEDEA] p-3 text-sm text-[#A4352A]">{error}</div> : null}

        <section className="space-y-3">
          <HomeSectionTitle title="Student List" />
          {students.length ? (
            students.map((student) => (
              <TeacherStudentCard
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
              />
            ))
          ) : (
            <HomeEmptyState title="No enrolled students" text="Accepted students will appear here." />
          )}
        </section>
      </div>
      {kickTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#26323A]/35 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-5 text-[#26323A] shadow-[0_24px_70px_rgba(38,50,58,0.22)]">
            <h2 className="text-xl font-semibold">Remove student?</h2>
            <p className="mt-2 text-sm leading-6 text-[#6B747B]">
              {kickTarget.studentName} will be removed from {program.title}. They will receive a notification in their inbox.
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
    </div>
  );
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

  const teacherIds = Array.from(new Set((programData ?? []).map((program) => program.teacher_profile_id).filter(Boolean))) as string[];
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
      teacher: teachers.find((teacher) => teacher.id === program.teacher_profile_id) ?? null,
    })),
  };

  mosqueProgramsCache.set(slug, snapshot);
  return snapshot;
}

function useTeacherPrograms(slug: string) {
  const [programs, setPrograms] = useState<Program[]>([]);
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
          setError("Teacher account required.");
          setLoading(false);
        }
        return;
      }

      if (!mosque) {
        if (active) {
          setPrograms([]);
          setLoading(false);
        }
        return;
      }

      const [{ data: mosquePrograms, error: programError }, { data: assignments, error: assignmentError }] = await Promise.all([
        supabase.from("programs").select("*").eq("mosque_id", mosque.id).eq("is_active", true).order("title", { ascending: true }),
        supabase.from("program_teachers").select("program_id").eq("teacher_profile_id", userId),
      ]);

      if (programError || assignmentError) {
        if (active) {
          setError(programError?.message ?? assignmentError?.message ?? "Could not load assigned classes.");
          setLoading(false);
        }
        return;
      }

      const assignedIds = new Set((assignments ?? []).map((assignment) => assignment.program_id));
      if (active) {
        setPrograms((mosquePrograms ?? []).filter((program) => program.teacher_profile_id === userId || assignedIds.has(program.id)));
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

  return { programs, currentUserId, loading, error };
}

function useStudentPrograms(slug: string) {
  const base = useMosquePrograms(slug);
  const [enrolledProgramIds, setEnrolledProgramIds] = useState<string[]>([]);
  const [programOwnerLabels, setProgramOwnerLabels] = useState<Record<string, string[]>>({});
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
            setAccountType(nextAccountType);
            setEnrollmentLoading(false);
          }
          return;
        }

        const { data } = await supabase.from("enrollments").select("program_id, student_profile_id").in("student_profile_id", childIds);
        const childNameById = new Map(children.map((child) => [child.id, child.full_name?.trim() || "Child"]));
        const owners: Record<string, string[]> = {};
        for (const row of data ?? []) {
          const childName = childNameById.get(row.student_profile_id);
          if (!childName) {
            continue;
          }
          owners[row.program_id] = Array.from(new Set([...(owners[row.program_id] ?? []), childName]));
        }
        if (active) {
          setEnrolledProgramIds(Object.keys(owners));
          setProgramOwnerLabels(owners);
          setAccountType(nextAccountType);
          setEnrollmentLoading(false);
        }
        return;
      }

      const { data } = await supabase.from("enrollments").select("program_id").eq("student_profile_id", userId);
      if (active) {
        setEnrolledProgramIds((data ?? []).map((row) => row.program_id));
        setProgramOwnerLabels({});
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

  return { ...base, enrolledProgramIds, programOwnerLabels, accountType, enrollmentLoading };
}

function useStudentUnreadAnnouncements(slug: string) {
  const { announcementCount } = useStudentNotificationCounts(slug);
  return { unreadCount: announcementCount };
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
    .select("id, full_name, email, phone_number, avatar_url, age, gender, date_of_birth")
    .in("id", childIds);

  return { mosqueId, children: (children ?? []) as StudentDisplay[] };
}

export function useStudentNotificationCounts(slug: string) {
  const cachedCounts = notificationCountsCache.get(slug);
  const [announcementCount, setAnnouncementCount] = useState(cachedCounts?.announcementCount ?? 0);
  const [requestCount, setRequestCount] = useState(cachedCounts?.requestCount ?? 0);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    function setCounts(nextCounts: NotificationCounts) {
      notificationCountsCache.set(slug, nextCounts);
      if (active) {
        setAnnouncementCount(nextCounts.announcementCount);
        setRequestCount(nextCounts.requestCount);
      }
    }

    async function load() {
      if (!slug) {
        setCounts({ announcementCount: 0, requestCount: 0 });
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setCounts({ announcementCount: 0, requestCount: 0 });
        return;
      }

      const { data: mosque } = await supabase.from("mosques").select("id").eq("slug", slug).maybeSingle();
      if (!mosque) {
        setCounts({ announcementCount: 0, requestCount: 0 });
        return;
      }

      const { data: profile } = await supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle();
      const { children } = profile?.account_type === "parent" ? await fetchParentChildren(supabase, slug, userId, mosque.id) : { children: [] as StudentDisplay[] };
      const targetStudentIds = profile?.account_type === "parent" ? children.map((child) => child.id) : [userId];
      const [{ data: enrollments }, { data: requestRows }] = await Promise.all([
        targetStudentIds.length
          ? supabase.from("enrollments").select("program_id").in("student_profile_id", targetStudentIds)
          : Promise.resolve({ data: [] as Array<{ program_id: string }> }),
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
      ]);

      const seenRequestIds = readSeenNotificationIds(seenStudentRequestsStorageKey, userId);
      const nextRequestCount = (requestRows ?? []).filter((request) => !seenRequestIds.has(studentRequestNotificationKey(request))).length;

      const programIds = (enrollments ?? []).map((row) => row.program_id);
      if (programIds.length === 0) {
        setCounts({ announcementCount: 0, requestCount: nextRequestCount });
        return;
      }

      const { data: announcements } = await supabase.from("program_announcements").select("id").in("program_id", programIds);
      const announcementIds = (announcements ?? []).map((item) => item.id);
      if (announcementIds.length === 0) {
        setCounts({ announcementCount: 0, requestCount: nextRequestCount });
        return;
      }

      const { data: receipts } = await supabase
        .from("program_announcement_receipts")
        .select("announcement_id, read_at, dismissed_at")
        .eq("profile_id", userId)
        .in("announcement_id", announcementIds);
      const readOrDismissed = new Set((receipts ?? []).filter((receipt) => receipt.read_at || receipt.dismissed_at).map((receipt) => receipt.announcement_id));
      setCounts({ announcementCount: announcementIds.filter((id) => !readOrDismissed.has(id)).length, requestCount: nextRequestCount });
    }

    void load();
    window.addEventListener("tareeqah:notifications-changed", load);
    return () => {
      active = false;
      window.removeEventListener("tareeqah:notifications-changed", load);
    };
  }, [slug]);

  return { announcementCount, requestCount, totalCount: announcementCount + requestCount };
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
        supabase.from("programs").select("id, teacher_profile_id").eq("mosque_id", mosque.id).eq("is_active", true),
        supabase.from("program_teachers").select("program_id").eq("teacher_profile_id", userId),
      ]);
      const assignedIds = new Set((assignments ?? []).map((assignment) => assignment.program_id));
      const programIds = (mosquePrograms ?? [])
        .filter((program) => program.teacher_profile_id === userId || assignedIds.has(program.id))
        .map((program) => program.id);

      if (programIds.length === 0) {
        if (active) {
          setRequestCount(0);
        }
        return;
      }

      const { data: rows } = await supabase.from("enrollment_requests").select("id").in("program_id", programIds).eq("status", "pending");
      const seenRequestIds = readSeenNotificationIds(seenTeacherRequestsStorageKey, userId);
      if (active) {
        setRequestCount((rows ?? []).filter((row) => !seenRequestIds.has(row.id)).length);
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

function SegmentedTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; badge?: number }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-[#E8DDCB] bg-[var(--workspace)] p-3">
      <div className="grid rounded-full bg-[var(--placeholder-soft)] p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative min-h-10 rounded-full px-3 text-sm font-semibold transition",
              value === tab.id ? "bg-[#fffdf8] text-[#17624F] shadow-sm" : "text-[#6B747B]",
            )}
          >
            {tab.label}
            {tab.badge ? <NotificationBadge count={tab.badge} className="-right-1 -top-1" /> : null}
          </button>
        ))}
      </div>
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

function InboxSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#D6DCE0] bg-white shadow-[0_8px_22px_rgba(38,50,58,0.06)]">
      <div className="flex min-h-12 items-center justify-between border-b border-[#E6ECEF] px-4">
        <h2 className="text-sm font-semibold text-[#26323A]">{title}</h2>
        <span className="rounded-full bg-[#E8F7F2] px-2.5 py-1 text-xs font-semibold text-[#17624F]">{count}</span>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function TeacherRequestSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-10 items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold text-[#26323A]">{title}</h2>
        <span className="min-w-8 rounded-full bg-[#E8F7F2] px-2.5 py-1 text-center text-xs font-semibold text-[#17624F]">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function MiniEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[#D6DCE0] px-4 py-6 text-center text-sm text-[#6B747B]">{text}</div>;
}

function InboxLoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center" aria-label={label}>
      <span className="h-11 w-11 animate-spin rounded-full border-4 border-[var(--placeholder-strong)] border-t-[#2F8FB3]" aria-hidden />
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
  const message =
    request.review_note ??
    (isPaymentRequest
      ? "Your teacher approved this request. Complete registration to activate the class."
      : request.status === "approved"
        ? "Your request was approved."
        : request.status === "cancelled"
          ? `You were removed from ${request.program?.title ?? "this class"}.`
          : null);
  return (
    <article className={cn("rounded-xl border border-[#E1E8EC] bg-white p-3", isPaymentRequest && "border-[#CFE8D6] bg-[#FBFEFC]")}>
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

function TeacherAnnouncementBubble({ announcement }: { announcement: AnnouncementWithContext }) {
  const authorName = announcement.author?.full_name?.trim() || "You";

  return (
    <article className="flex gap-3">
      <Avatar src={announcement.author?.avatar_url ?? null} name={authorName} />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[#E1E8EC] bg-white p-3 shadow-[0_6px_18px_rgba(38,50,58,0.05)]">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-[#26323A]">You</h3>
          <span className="text-xs text-[#6B747B]">{timeAgo(announcement.created_at)}</span>
        </div>
        <p className="mt-1 text-xs font-medium text-[#2F8FB3]">{announcement.program?.title ?? "Class announcement"}</p>
        <p className="mt-2 text-sm leading-6 text-[#26323A]">{announcement.message}</p>
      </div>
    </article>
  );
}

function TeacherRequestCard({
  request,
  reviewed = false,
  onAccept,
  onReject,
}: {
  request: RequestWithContext;
  reviewed?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const studentName = request.student?.full_name ?? "Student";
  const isParentRequest = Boolean(request.parent_profile_id);
  const statusLabel = request.status.charAt(0).toUpperCase() + request.status.slice(1);

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
              {isParentRequest ? "Parent request" : "Student request"} • {request.program?.title ?? "Class request"}
            </p>
          </div>
          {reviewed ? (
            <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", request.status === "approved" ? "bg-[#EAF8EF] text-[#258A43]" : "bg-[#FDEDEA] text-[#C83F31]")}>
              {statusLabel}
            </span>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={onReject} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FCE8E4] text-[#C83F31] transition-colors hover:bg-[#F9D8D1]" aria-label={`Reject ${studentName}`}>
                <XIcon />
              </button>
              <button type="button" onClick={onAccept} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E2F6E8] text-[#258A43] transition-colors hover:bg-[#D4F0DD]" aria-label={`Accept ${studentName}`}>
                <CheckIcon />
              </button>
            </div>
          )}
          <button type="button" onClick={() => setExpanded((value) => !value)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E7F3F8] text-[#257B9C] transition-colors hover:bg-[#DDEEF6]" aria-label={expanded ? "Hide student details" : "Show student details"}>
            <ChevronIcon expanded={expanded} />
          </button>
        </div>
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="border-t border-[#E6ECEF] bg-[#F8FAFB] px-5 py-4">
              <dl className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)] gap-x-5 gap-y-3 text-sm">
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
            </div>
          </div>
        </div>
      </div>
    </article>
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

function TeacherStudentCard({
  item,
  busy,
  onKick,
}: {
  item: { enrollment: Enrollment; profile: StudentDisplay | null; parent?: ParentDisplay | null };
  busy: boolean;
  onKick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const studentName = item.profile?.full_name ?? "Student";

  return (
    <article className="relative pb-1">
      {!expanded ? <div className="absolute inset-x-8 bottom-0 h-3 rounded-b-[18px] bg-[#DDE7EC]" aria-hidden /> : null}
      <div className="relative overflow-hidden rounded-[24px] border border-[#E1E8EC] bg-white shadow-[0_10px_24px_rgba(38,50,58,0.07)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EEF6F7] text-[#2F8FB3]" aria-hidden>
            {item.profile?.avatar_url ? <Avatar src={item.profile.avatar_url} name={studentName} /> : <DefaultProfileIcon className="h-5 w-5" compact />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold leading-5 text-[#26323A]">{studentName}</h3>
          </div>
          <button
            type="button"
            onClick={onKick}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-[5px] bg-[#C83F31] px-3 text-xs font-semibold text-white shadow-[0_6px_14px_rgba(200,63,49,0.18)] transition-colors hover:bg-[#B6372C] disabled:opacity-60"
          >
            {busy ? "..." : "Kick"}
          </button>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E7F3F8] text-[#257B9C] transition-colors hover:bg-[#DDEEF6]" aria-label={expanded ? "Hide student details" : "Show student details"}>
            <ChevronIcon expanded={expanded} />
          </button>
        </div>
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="border-t border-[#E6ECEF] bg-[#F8FAFB] px-5 py-4">
              <dl className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)] gap-x-5 gap-y-3 text-sm">
                <RequestDetail label="Email" value={item.profile?.email} />
                <RequestDetail label="Phone" value={item.profile?.phone_number} />
                <RequestDetail label="Age" value={displayAge(item.profile)} />
                <RequestDetail label="Gender" value={item.profile?.gender} />
                {item.parent ? (
                  <>
                    <RequestDetail label="Parent" value={item.parent.full_name} />
                    <RequestDetail label="Parent Phone" value={item.parent.phone_number} />
                    <RequestDetail label="Parent Email" value={item.parent.email} />
                  </>
                ) : null}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function RequestDetail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#7B858C]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold leading-5 text-[#26323A]">{value?.trim() || "Not provided"}</dd>
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

function StudentsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

function ChildEnrollmentSelector({
  program,
  childrenProfiles,
  statuses,
  selectedChildIds,
  onToggle,
  onSubmit,
  busy,
}: {
  program: Program;
  childrenProfiles: StudentDisplay[];
  statuses: Record<string, { enrolled: boolean; requestStatus: string | null }>;
  selectedChildIds: string[];
  onToggle: (childId: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-[#D6E6E9] bg-[#F8FCFB] p-3">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-[#6B747B]">Select children</p>
      <div className="mt-2 space-y-2">
        {childrenProfiles.map((child) => {
          const status = statuses[child.id];
          const eligibility = isProfileEligibleForProgram(child, program);
          const locked = status?.enrolled || status?.requestStatus === "pending" || !eligibility.eligible;
          const checked = selectedChildIds.includes(child.id);
          const detail = status?.enrolled ? "Already enrolled" : status?.requestStatus === "pending" ? "Pending review" : eligibility.eligible ? displayAge(child) : eligibility.reason;
          return (
            <button
              key={child.id}
              type="button"
              onClick={() => (locked ? undefined : onToggle(child.id))}
              disabled={locked}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-xl bg-white px-3 text-left text-sm ring-1 ring-[#E1E8EC] transition",
                checked && "ring-2 ring-[#248B72]",
                locked && "cursor-not-allowed opacity-65",
              )}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", checked ? "border-[#248B72] bg-[#248B72] text-white" : "border-[#B9C3C8]")}>
                {checked ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[#26323A]">{child.full_name ?? "Child"}</span>
                <span className={cn("block truncate text-xs", eligibility.eligible ? "text-[#6B747B]" : "text-[#A34B16]")}>{detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || selectedChildIds.length === 0}
        className="mt-3 min-h-11 w-full rounded-full bg-[#17624F] px-4 text-sm font-semibold text-white disabled:opacity-60"
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
        <TransitionLink key={program.id} href={`/m/${mosqueSlug}/portal/classes/${program.id}`} label="Class Details" className="overflow-hidden rounded-xl bg-white shadow-md">
          <ProgramHero program={program} />
          <div className="p-4">
            <h3 className="text-lg font-medium text-[#26323A]">{program.title}</h3>
          </div>
        </TransitionLink>
      ))}
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
    <div className="relative flex h-36 items-end bg-[radial-gradient(circle_at_top_left,#E5FFF0_0,#7ECFC2_52%,#2E9B82_100%)] p-4">
      <div className="text-4xl font-medium text-white/85">{initials(program.title)}</div>
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
  return (
    <section className="space-y-5 bg-[var(--workspace)] p-4" aria-label="Loading home">
      <div className="rounded-[30px] bg-[#fffdf8] p-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)]">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[var(--placeholder)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-36 animate-pulse rounded-full bg-[var(--placeholder)]" />
            <div className="h-4 w-44 animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
          </div>
          <div className="h-10 w-20 animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
        </div>
      </div>
      <HomeSectionTitle title="Upcoming" />
      <div className="space-y-5">
        <div className="grid grid-cols-7 gap-1 px-1">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-1.5">
              <div className="h-14 w-full max-w-12 animate-pulse rounded-2xl bg-[var(--placeholder)]" />
              <div className="h-2 w-3 animate-pulse rounded-full bg-[var(--placeholder-strong)]" />
            </div>
          ))}
        </div>
        <div className="rounded-[24px] bg-[#fffdf8] px-4 py-3 shadow-[0_8px_24px_rgba(38,50,58,0.06)]">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[var(--placeholder)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-44 animate-pulse rounded-full bg-[var(--placeholder)]" />
              <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
            </div>
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#A8C9D4]" />
          </div>
        </div>
      </div>
    </section>
  );
}

type HomeLesson = {
  program: Program | ProgramWithTeacher;
  ownerLabel?: string;
  date: Date;
  startsAt: Date;
  endsAt: Date | null;
  start: string;
  end: string;
  color: string;
};

const lessonColors = ["#3F88C5", "#34A853", "#D9A72E", "#8B5CF6", "#E25241", "#22A6B3"];

function HomeUpcomingRows({
  programs,
  ownerLabelsByProgramId = {},
  canCancelSessions = false,
  currentUserId = null,
}: {
  programs: Array<Program | ProgramWithTeacher>;
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
  return (
    <div className="space-y-5" aria-label="Loading upcoming classes">
      <div className="grid grid-cols-7 gap-1 px-1">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="flex flex-col items-center gap-1.5">
            <div className="h-14 w-full max-w-12 animate-pulse rounded-2xl bg-[var(--placeholder)]" />
            <div className="h-2 w-3 animate-pulse rounded-full bg-[var(--placeholder-strong)]" />
          </div>
        ))}
      </div>
      <div className="rounded-[24px] bg-[#fffdf8] px-4 py-3 shadow-[0_8px_24px_rgba(38,50,58,0.06)]">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[var(--placeholder)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-44 animate-pulse rounded-full bg-[var(--placeholder)]" />
            <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
          </div>
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#A8C9D4]" />
        </div>
      </div>
    </div>
  );
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
              {lessons.slice(0, 3).map((lesson) => (
                <span key={`${lesson.program.id}-${lesson.start}`} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lesson.color }} aria-hidden />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HomeUpcomingLesson({ lesson, canCancel = false, onCancel }: { lesson: HomeLesson; canCancel?: boolean; onCancel?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[24px] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(38,50,58,0.06)]">
      <HomeProgramThumb program={lesson.program} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-[#26323A]">{lesson.program.title}</h3>
        <p className="mt-0.5 truncate text-sm text-[#6B747B]">{lesson.ownerLabel ? `${lesson.ownerLabel} • ${lessonTimeRange(lesson)}` : lessonTimeRange(lesson)}</p>
      </div>
      {canCancel ? (
        <button type="button" onClick={onCancel} className="shrink-0 rounded-[7px] bg-[#C83F31] px-3 py-2 text-xs font-semibold text-white">
          Cancel
        </button>
      ) : (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lesson.color }} aria-hidden />
      )}
    </div>
  );
}

function HomeProgramThumb({ program }: { program: Program | ProgramWithTeacher }) {
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

function weekLessons(sources: Array<{ program: Program | ProgramWithTeacher; ownerLabel?: string }>, week: Date[]) {
  const lessons: HomeLesson[] = [];

  sources.forEach(({ program, ownerLabel }, programIndex) => {
    const rows = parseProgramSchedule(program.schedule);
    rows.forEach((row, rowIndex) => {
      const date = week.find((day) => weekdayName(day).toLowerCase() === row.day.toLowerCase());
      if (!date) {
        return;
      }

      const startsAt = withTime(date, row.start);
      lessons.push({
        program,
        ownerLabel,
        date,
        startsAt,
        endsAt: row.end ? withTime(date, row.end) : null,
        start: row.start,
        end: row.end,
        color: lessonColors[(programIndex + rowIndex) % lessonColors.length],
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

function TeacherClassCard({ program, mosqueSlug }: { program: Program; mosqueSlug: string }) {
  const schedule = scheduleSummary(program.schedule, program.schedule_notes);
  const age = formatAgeRange(program.age_range_text);
  const gender = formatGender(program.audience_gender);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#D6DCE0] bg-white shadow-[0_10px_26px_rgba(38,50,58,0.08)]">
      <TransitionLink href={`/m/${mosqueSlug}/teacher/classes/${program.id}`} label="Class Details" className="block transition-opacity hover:opacity-95">
        <ProgramHero program={program} />
      </TransitionLink>
      <div className="space-y-4 p-4">
        <div>
          <TransitionLink href={`/m/${mosqueSlug}/teacher/classes/${program.id}`} label="Class Details" className="line-clamp-2 text-lg font-semibold leading-6 text-[#26323A] hover:text-[#17624F]">
            {program.title}
          </TransitionLink>
          <p className="mt-1 text-sm text-[#6B747B]">{schedule.full}</p>
        </div>
        <AudienceDetails age={age} gender={gender} />
        <div className="grid grid-cols-3 gap-2">
          <TeacherActionLink href={`/m/${mosqueSlug}/teacher/classes/${program.id}/students`} icon={<StudentsIcon />} label="Manage Students" previewLabel="Students" />
          <TeacherActionLink href={`/m/${mosqueSlug}/teacher/classes/${program.id}/announcement`} icon={<MegaphoneIcon />} label="Make Announcement" previewLabel="Announcement" />
          <TeacherActionLink href={`/m/${mosqueSlug}/teacher/classes/${program.id}/schedule`} icon={<ScheduleIcon />} label="Edit Schedule" previewLabel="Schedule" />
        </div>
      </div>
    </article>
  );
}

function TeacherActionLink({ href, icon, label, previewLabel }: { href: string; icon: ReactNode; label: string; previewLabel?: string }) {
  return (
    <TransitionLink href={href} label={previewLabel ?? label} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl bg-[#F7FBFC] px-2 text-center text-sm font-semibold text-[#26323A] ring-1 ring-[#E1E8EC] transition-colors hover:bg-[#EAF5F7]">
      <span className="flex h-9 min-w-12 items-center justify-center rounded-full bg-[#E7F3F8] px-3 text-[#2F8FB3]" aria-hidden>
        {icon}
      </span>
      <span className="leading-4">{label}</span>
    </TransitionLink>
  );
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
  return (
    <section className="mt-8">
      <p className="text-sm leading-6 text-[#6B747B]">Temporary development switcher. Tap a test account to sign in immediately.</p>

      <div className="mt-7 overflow-hidden rounded-[28px] bg-white shadow-[0_18px_45px_rgba(38,50,58,0.08)] ring-1 ring-[#E4EAEE]">
        {accounts.map((account, index) => (
          <button
            key={`${account.accountType}-${account.email}`}
            type="button"
            onClick={() => onSwitch(account)}
            disabled={busy}
            className={cn(
              "flex min-h-[76px] w-full items-center gap-4 px-5 text-left transition-colors hover:bg-[#F6FAFA] disabled:cursor-wait disabled:opacity-70",
              index > 0 && "border-t border-[#ECF0F2]",
            )}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E9F7F8] text-sm font-semibold uppercase text-[#257B9C]">
              {account.accountType.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold text-[#26323A]">{account.label}</span>
              <span className="mt-0.5 block truncate text-sm text-[#6B747B]">{account.email}</span>
            </span>
            <span className="text-sm font-semibold text-[#17624F]">{busy && busyEmail === account.email ? "Switching" : account.accountType}</span>
          </button>
        ))}
        {!accounts.length ? <p className="px-5 py-6 text-sm leading-6 text-[#6B747B]">No test accounts are configured.</p> : null}
      </div>

      <div className="mt-5 space-y-3">
        <p className="text-xs leading-5 text-[#8A949B]">To change these, set <span className="font-semibold text-[#26323A]">NEXT_PUBLIC_DEV_SWITCH_ACCOUNTS</span> to a JSON array of label, email, password, and accountType.</p>
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
  return (
    <div className="space-y-3 p-4">
      <div className="h-12 bg-[var(--placeholder-soft)]" />
      <div className="h-12 bg-[var(--placeholder-soft)]" />
    </div>
  );
}

function ProgramDetailLoadingState() {
  return (
    <div className="space-y-5 bg-[var(--workspace)] p-4">
      <div className="overflow-hidden rounded-[28px] bg-[#fffdf8] shadow-[0_12px_30px_rgba(38,50,58,0.08)]">
        <div className="h-40 animate-pulse bg-[var(--placeholder)]" />
        <div className="space-y-3 p-4">
          <div className="h-4 w-36 animate-pulse rounded-full bg-[var(--placeholder-strong)]" />
          <div className="h-7 w-4/5 animate-pulse rounded-full bg-[var(--placeholder)]" />
          <div className="h-4 w-full animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
          <div className="h-4 w-3/4 animate-pulse rounded-full bg-[var(--placeholder-soft)]" />
        </div>
      </div>
      <div className="rounded-[24px] bg-[#fffdf8] p-5 shadow-[0_12px_28px_rgba(38,50,58,0.06)]">
        <div className="h-6 w-44 animate-pulse rounded-full bg-[var(--placeholder)]" />
        <div className="mt-5 grid gap-3">
          <div className="h-12 animate-pulse rounded-2xl bg-[var(--placeholder-soft)]" />
          <div className="h-12 animate-pulse rounded-2xl bg-[var(--placeholder-soft)]" />
          <div className="h-12 animate-pulse rounded-2xl bg-[var(--placeholder-soft)]" />
        </div>
      </div>
    </div>
  );
}

function ClassesLoadingPlaceholders({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-4 bg-[var(--workspace)] p-4 md:grid-cols-2" aria-label="Loading classes">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[22px] border border-[#E8DDCB] bg-[#fffdf8] shadow-[0_12px_28px_rgba(38,50,58,0.08)]">
          <div className="h-36 animate-pulse bg-[var(--placeholder)]" />
          <div className="space-y-3 p-4">
            <div className="h-6 w-3/4 animate-pulse rounded bg-[var(--placeholder)]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--placeholder-soft)]" />
            <div className="flex gap-3 pt-2">
              <div className="h-9 flex-1 animate-pulse rounded bg-[var(--placeholder-soft)]" />
              <div className="h-9 flex-1 animate-pulse rounded bg-[var(--placeholder-soft)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
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

function displayAge(profile: Pick<Profile, "date_of_birth" | "age"> | null | undefined) {
  const calculatedAge = calculateAge(profile?.date_of_birth ?? null);
  if (calculatedAge !== null) {
    return `${calculatedAge}`;
  }
  return profile?.age?.trim() || "Not provided";
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
      return { eligible: false, reason: "Age is required for this class." };
    }
    if (ageBounds.min !== null && age < ageBounds.min) {
      return { eligible: false, reason: `Must be ${ageBounds.min}+ for this class.` };
    }
    if (ageBounds.max !== null && age > ageBounds.max) {
      return { eligible: false, reason: `Must be ${ageBounds.max} or younger for this class.` };
    }
  }

  const audience = formatGender(program.audience_gender);
  const gender = normalizeGender(profile?.gender ?? null);
  if (audience === "Brothers Only" && gender !== "male") {
    return { eligible: false, reason: "Brothers only." };
  }
  if (audience === "Sisters Only" && gender !== "female") {
    return { eligible: false, reason: "Sisters only." };
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
