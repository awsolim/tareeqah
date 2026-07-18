// Centralized program status model: visibility, applications, timing, lifecycle.
// Single source of truth for status-derived behavior — call these instead of
// re-deriving conditionals against raw publication_status/application_status/
// lifecycle_status fields wherever a program's state matters.

export type PublicationStatus = "draft" | "published" | "hidden" | "archived";
export type ApplicationStatus = "accepting" | "not_accepting" | "opens_later" | "waitlist_only" | "closed" | "invite_only";
export type LifecycleStatus = "upcoming" | "active" | "paused" | "completed" | "cancelled" | "archived";
export type BillingEndBehavior = "manual_cancel" | "program_end" | "fixed_months";

export type ProgramStatusFields = {
  publicationStatus: PublicationStatus;
  applicationStatus: ApplicationStatus;
  lifecycleStatus: LifecycleStatus;
  applicationOpenAt: string | null;
  applicationCloseAt: string | null;
  startDate: string | null;
  endDate: string | null;
  isOngoing: boolean;
  billingEndBehavior?: BillingEndBehavior;
  offersAnnualPayment?: boolean;
};

const PUBLICATION_STATUSES: readonly PublicationStatus[] = ["draft", "published", "hidden", "archived"];
const APPLICATION_STATUSES: readonly ApplicationStatus[] = ["accepting", "not_accepting", "opens_later", "waitlist_only", "closed", "invite_only"];
const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = ["upcoming", "active", "paused", "completed", "cancelled", "archived"];
const MANUAL_LIFECYCLE_OVERRIDES: readonly LifecycleStatus[] = ["paused", "cancelled", "archived"];

/**
 * Upcoming/active/completed are always computed from timing, never chosen
 * directly — paused/cancelled/archived are the only lifecycle states staff can
 * set manually, and they stick until staff change them again.
 *
 *   start_date in the future        -> upcoming
 *   started, no end date (or not yet ended) -> active
 *   end_date has passed             -> completed
 */
export function deriveLifecycleStatus(input: {
  lifecycleStatus: LifecycleStatus;
  startNow: boolean;
  startDate: string | null;
  endDate: string | null;
  isOngoing: boolean;
}): LifecycleStatus {
  if (MANUAL_LIFECYCLE_OVERRIDES.includes(input.lifecycleStatus)) {
    return input.lifecycleStatus;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  const started = input.startNow || (input.startDate ? new Date(`${input.startDate}T00:00:00`).getTime() <= todayTime : false);
  if (!started) {
    return "upcoming";
  }

  if (!input.isOngoing && input.endDate && new Date(`${input.endDate}T00:00:00`).getTime() < todayTime) {
    return "completed";
  }

  return "active";
}

function coerce<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Adapt a loose DB row (or partial builder state) into strict status fields. */
export function toProgramStatusFields(row: {
  publication_status?: string | null;
  application_status?: string | null;
  lifecycle_status?: string | null;
  application_open_at?: string | null;
  application_close_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_ongoing?: boolean | null;
  billing_end_behavior?: string | null;
}): ProgramStatusFields {
  return {
    publicationStatus: coerce(row.publication_status, PUBLICATION_STATUSES, "published"),
    applicationStatus: coerce(row.application_status, APPLICATION_STATUSES, "not_accepting"),
    lifecycleStatus: coerce(row.lifecycle_status, LIFECYCLE_STATUSES, "upcoming"),
    applicationOpenAt: row.application_open_at ?? null,
    applicationCloseAt: row.application_close_at ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    isOngoing: Boolean(row.is_ongoing),
    billingEndBehavior: row.billing_end_behavior ? coerce(row.billing_end_behavior, ["manual_cancel", "program_end", "fixed_months"] as const, "manual_cancel") : undefined,
  };
}

const NEVER_ACCEPTS_LIFECYCLE: readonly LifecycleStatus[] = ["completed", "cancelled", "archived"];

/**
 * Enforces rules 1-3 & 11: draft, archived, or a finished/cancelled lifecycle can
 * never accept applications, regardless of what the stored application_status
 * says. Call before persisting so bad combinations can't reach the database.
 */
export function normalizeProgramStatusFields(fields: ProgramStatusFields): ProgramStatusFields {
  const forceClosed =
    fields.publicationStatus === "draft" ||
    fields.publicationStatus === "archived" ||
    NEVER_ACCEPTS_LIFECYCLE.includes(fields.lifecycleStatus);

  if (forceClosed) {
    const closedStatus: ApplicationStatus = fields.publicationStatus === "draft" ? "not_accepting" : "closed";
    if (fields.applicationStatus === "accepting" || fields.applicationStatus === "opens_later" || fields.applicationStatus === "waitlist_only") {
      return { ...fields, applicationStatus: closedStatus };
    }
    return fields;
  }

  // Dates are the source of truth even if the stored status hasn't caught up yet
  // (e.g. an "opens_later" program whose open date has since passed, or an
  // "accepting" program whose close date has quietly gone by).
  const now = Date.now();
  const openAt = fields.applicationOpenAt ? new Date(fields.applicationOpenAt).getTime() : null;
  const closeAt = fields.applicationCloseAt ? new Date(fields.applicationCloseAt).getTime() : null;

  if (fields.applicationStatus === "accepting" && closeAt !== null && closeAt < now) {
    return { ...fields, applicationStatus: "closed" };
  }
  if (fields.applicationStatus === "accepting" && openAt !== null && openAt > now) {
    return { ...fields, applicationStatus: "opens_later" };
  }
  if (fields.applicationStatus === "opens_later" && openAt !== null && openAt <= now && (closeAt === null || closeAt >= now)) {
    return { ...fields, applicationStatus: "accepting" };
  }

  return fields;
}

/** Can this program currently accept a new application/enrollment request? */
export function canAcceptApplications(fields: ProgramStatusFields): boolean {
  const normalized = normalizeProgramStatusFields(fields);
  return normalized.applicationStatus === "accepting";
}

/** Should this program appear in the public masjid classes list? */
export function isPubliclyListed(fields: Pick<ProgramStatusFields, "publicationStatus" | "lifecycleStatus">): boolean {
  return fields.publicationStatus === "published" && !["cancelled", "archived"].includes(fields.lifecycleStatus);
}

/** Can an unauthenticated visitor open this program's detail page directly (e.g. via a shared link)? */
export function isVisibleByDirectLink(fields: Pick<ProgramStatusFields, "publicationStatus">): boolean {
  return fields.publicationStatus === "published" || fields.publicationStatus === "hidden";
}

export type ApplicationButtonState =
  | { type: "open"; label: string }
  | { type: "scheduled"; label: string; opensAt: string | null }
  | { type: "waitlist"; label: string }
  | { type: "invite"; label: string }
  | { type: "not_accepting"; label: string }
  | { type: "closed"; label: string };

/** What should the public apply/register button say and do? */
export function getApplicationButtonState(fields: ProgramStatusFields): ApplicationButtonState {
  const normalized = normalizeProgramStatusFields(fields);
  switch (normalized.applicationStatus) {
    case "accepting":
      return { type: "open", label: "Apply / Register" };
    case "opens_later":
      return { type: "scheduled", label: normalized.applicationOpenAt ? `Applications open on ${formatDateLabel(normalized.applicationOpenAt)}` : "Applications open soon", opensAt: normalized.applicationOpenAt };
    case "waitlist_only":
      return { type: "waitlist", label: "Join Waitlist" };
    case "invite_only":
      return { type: "invite", label: "Invite required" };
    case "closed":
      return { type: "closed", label: "Applications are closed" };
    case "not_accepting":
    default:
      return { type: "not_accepting", label: "Applications are not currently open" };
  }
}

export type ProgramPrimaryCta =
  | { kind: "link"; label: string; href: string }
  | { kind: "disabled"; label: string }
  | { kind: "pill"; label: string; tone: "positive" | "warning" | "neutral" };

/**
 * The single decision tree for the public applicant-facing CTA (student/parent
 * viewers only — teacher/admin account pills are handled separately since
 * they're not part of the applicant wording at all). Centralizes what used to
 * be scattered inline JSX conditionals on the program detail page.
 */
export function getProgramPrimaryCta(input: {
  fields: ProgramStatusFields;
  isSignedIn: boolean;
  isEnrolled: boolean;
  requestStatus: string | null;
  paymentDue: boolean;
  capacityFull: boolean;
  waitlistAllowed: boolean;
  applyHref: string;
  viewEnrollmentHref: string;
  completePaymentHref: string;
}): ProgramPrimaryCta {
  const { fields, isSignedIn, isEnrolled, requestStatus, paymentDue, capacityFull, waitlistAllowed, applyHref, viewEnrollmentHref, completePaymentHref } = input;

  // Guests are browse-only — no application/payment action is ever clickable
  // until they sign in through the normal account flow.
  if (!isSignedIn) {
    return { kind: "disabled", label: "Log In to Apply" };
  }

  if (isEnrolled) {
    return { kind: "link", label: "View Enrollment", href: viewEnrollmentHref };
  }
  if (requestStatus === "approved" && paymentDue) {
    return { kind: "link", label: "Complete Payment", href: completePaymentHref };
  }
  if (requestStatus === "pending") {
    return { kind: "pill", label: "Application Submitted", tone: "warning" };
  }
  if (requestStatus === "waitlisted") {
    return { kind: "pill", label: "Waitlisted", tone: "warning" };
  }

  if (["completed", "cancelled", "archived"].includes(fields.lifecycleStatus)) {
    return { kind: "disabled", label: "Applications Closed" };
  }

  const applicationState = getApplicationButtonState(fields);

  if (fields.lifecycleStatus === "paused" && applicationState.type !== "open" && applicationState.type !== "waitlist") {
    return { kind: "disabled", label: "Applications Not Open" };
  }
  if (applicationState.type === "not_accepting") {
    return { kind: "disabled", label: "Applications Not Open" };
  }
  if (applicationState.type === "closed") {
    return { kind: "disabled", label: "Applications Closed" };
  }
  if (applicationState.type === "invite") {
    return { kind: "disabled", label: "Invite Required" };
  }
  if (applicationState.type === "scheduled") {
    return { kind: "disabled", label: applicationState.label };
  }
  if (applicationState.type === "waitlist") {
    return { kind: "link", label: "Join Waitlist", href: applyHref };
  }

  if (capacityFull) {
    return waitlistAllowed ? { kind: "link", label: "Join Waitlist", href: applyHref } : { kind: "disabled", label: "Class Full" };
  }

  return { kind: "link", label: "Apply to Register", href: applyHref };
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export type ProgramStatusBadge = { label: string; tone: "neutral" | "positive" | "warning" | "danger" };

/** Human badges for staff-facing program lists (visibility + lifecycle + applications). */
export function getProgramStatusBadges(fields: ProgramStatusFields): ProgramStatusBadge[] {
  const badges: ProgramStatusBadge[] = [];

  badges.push(
    fields.publicationStatus === "draft"
      ? { label: "Draft", tone: "neutral" }
      : fields.publicationStatus === "hidden"
        ? { label: "Hidden", tone: "warning" }
        : fields.publicationStatus === "archived"
          ? { label: "Archived", tone: "neutral" }
          : { label: "Published", tone: "positive" },
  );

  const lifecycleLabel: Record<LifecycleStatus, string> = {
    upcoming: "Upcoming",
    active: "Active",
    paused: "Paused",
    completed: "Completed",
    cancelled: "Cancelled",
    archived: "Archived",
  };
  const lifecycleTone: Record<LifecycleStatus, ProgramStatusBadge["tone"]> = {
    upcoming: "neutral",
    active: "positive",
    paused: "warning",
    completed: "neutral",
    cancelled: "danger",
    archived: "neutral",
  };
  badges.push({ label: lifecycleLabel[fields.lifecycleStatus], tone: lifecycleTone[fields.lifecycleStatus] });

  const applicationState = getApplicationButtonState(fields);
  const applicationBadge: Record<ApplicationButtonState["type"], string> = {
    open: "Applications open",
    scheduled: "Opens later",
    waitlist: "Waitlist only",
    invite: "Invite only",
    not_accepting: "Not accepting",
    closed: "Closed",
  };
  badges.push({ label: applicationBadge[applicationState.type], tone: applicationState.type === "open" ? "positive" : applicationState.type === "closed" ? "danger" : "neutral" });

  return badges;
}

export type ProgramStatusValidationError = { field: string; message: string };

/**
 * Rules that should block a save with a clear message rather than being
 * silently auto-corrected (dates, opens_later needing a date, ongoing/billing
 * conflicts). Auto-correctable invariants live in normalizeProgramStatusFields.
 */
export function validateProgramStatusCombination(fields: ProgramStatusFields): { valid: boolean; errors: ProgramStatusValidationError[] } {
  const errors: ProgramStatusValidationError[] = [];

  if (fields.applicationStatus === "opens_later" && !fields.applicationOpenAt) {
    errors.push({ field: "applicationOpenAt", message: "Choose when applications open, or pick a different application option." });
  }

  if (fields.applicationOpenAt && fields.applicationCloseAt) {
    if (new Date(fields.applicationCloseAt).getTime() <= new Date(fields.applicationOpenAt).getTime()) {
      errors.push({ field: "applicationCloseAt", message: "Application close date must be after the open date." });
    }
  }

  if (!fields.isOngoing && fields.startDate && fields.endDate) {
    if (new Date(fields.endDate).getTime() <= new Date(fields.startDate).getTime()) {
      errors.push({ field: "endDate", message: "End date must be after the start date." });
    }
  }

  if (fields.isOngoing && fields.billingEndBehavior === "program_end") {
    errors.push({ field: "billingEndBehavior", message: "Ongoing programs cannot automatically end billing at a program end date — choose manual cancellation instead." });
  }

  if (fields.isOngoing && fields.offersAnnualPayment) {
    errors.push({ field: "offersAnnualPayment", message: "Ongoing programs can't offer Pay in Full — switch to Monthly Subscription or Free." });
  }

  return { valid: errors.length === 0, errors };
}
