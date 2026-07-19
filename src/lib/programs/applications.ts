// Post-application workflow status model: application status (review/registration
// process state), payment status (money/subscription state), and enrollment
// status (actual class membership, tracked separately on `enrollments`) are
// kept as three independent dimensions. Both are fully derived from existing
// columns — no new schema needed. See supabase/migrations for the underlying
// enrollment_requests/program_subscriptions column definitions.

export type ApplicationStatus = "pending_review" | "waitlisted" | "rejected" | "approved_confirmation_required" | "completed_enrolled" | "cancelled";

export type ApplicationPaymentStatus = "not_required" | "waived" | "payment_required" | "checkout_pending" | "paid" | "active_subscription" | "past_due" | "failed" | "ended";

export type BadgeTone = "neutral" | "positive" | "warning" | "danger";

type ApplicationRequestLike = {
  status: string;
  admission_completed_at: string | null;
  payment_bypassed: boolean;
};

/** Derives the review/registration process state from the request's raw status + completion timestamp. */
export function getApplicationStatus(request: ApplicationRequestLike): ApplicationStatus {
  switch (request.status) {
    case "waitlisted":
      return "waitlisted";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "approved":
      return request.admission_completed_at ? "completed_enrolled" : "approved_confirmation_required";
    case "pending":
    default:
      return "pending_review";
  }
}

/** Derives the money/subscription state — independent of application status except that payment only becomes relevant once approved. */
export function getApplicationPaymentStatus(
  request: Pick<ApplicationRequestLike, "payment_bypassed" | "status">,
  program: { is_paid: boolean } | null | undefined,
  subscription: { status: string | null } | null | undefined,
): ApplicationPaymentStatus {
  if (!program?.is_paid) {
    return "not_required";
  }
  if (request.payment_bypassed) {
    return "waived";
  }
  if (request.status !== "approved") {
    return "not_required";
  }

  const subStatus = subscription?.status?.toLowerCase() ?? null;
  if (!subStatus) {
    return "payment_required";
  }
  if (subStatus === "checkout_started") {
    return "checkout_pending";
  }
  if (subStatus === "paid") {
    return "paid";
  }
  if (subStatus === "past_due") {
    return "past_due";
  }
  if (subStatus === "unpaid") {
    return "failed";
  }
  if (["canceled", "cancelled", "incomplete_expired"].includes(subStatus)) {
    return "ended";
  }
  if (["active", "trialing"].includes(subStatus)) {
    return "active_subscription";
  }
  return "payment_required";
}

/**
 * Whether payment status is worth displaying at all. For a paid program, payment status is
 * always "not_required" until the application is approved — showing it before that point is
 * just noise, not information. For a free program, "not_required" is a genuine, permanent fact
 * worth showing regardless of decision status.
 */
export function isPaymentStatusMeaningful(request: Pick<ApplicationRequestLike, "status">, program: { is_paid: boolean } | null | undefined): boolean {
  return !program?.is_paid || request.status === "approved";
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_review: "Pending Review",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  approved_confirmation_required: "Approved",
  completed_enrolled: "Completed / Enrolled",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_LABELS: Record<ApplicationPaymentStatus, string> = {
  not_required: "Not required",
  waived: "Waived",
  payment_required: "Payment required",
  checkout_pending: "Awaiting payment",
  paid: "Paid",
  active_subscription: "Subscription active",
  past_due: "Past due",
  failed: "Failed",
  ended: "Ended",
};

/** Table/row display label — combines both dimensions into the reader-friendly forms the spec asks for, without collapsing the underlying dimensions themselves. */
export function getApplicationRowStatusLabel(applicationStatus: ApplicationStatus, paymentStatus: ApplicationPaymentStatus): string {
  if (applicationStatus === "approved_confirmation_required") {
    return paymentStatus === "payment_required" || paymentStatus === "checkout_pending" ? "Approved — Waiting Payment" : "Approved — Waiting Confirmation";
  }
  return APPLICATION_STATUS_LABELS[applicationStatus];
}

export function applicationStatusTone(status: ApplicationStatus): BadgeTone {
  switch (status) {
    case "completed_enrolled":
      return "positive";
    case "approved_confirmation_required":
    case "waitlisted":
      return "warning";
    case "rejected":
      return "danger";
    case "pending_review":
    case "cancelled":
    default:
      return "neutral";
  }
}

export function paymentStatusTone(status: ApplicationPaymentStatus): BadgeTone {
  switch (status) {
    case "paid":
    case "active_subscription":
      return "positive";
    case "payment_required":
    case "checkout_pending":
      return "warning";
    case "past_due":
    case "failed":
      return "danger";
    case "waived":
    case "not_required":
    case "ended":
    default:
      return "neutral";
  }
}

export type ApplicationRowAction =
  | "view"
  | "approve"
  | "waitlist"
  | "reject"
  | "cancel_approval"
  | "change_price"
  | "waive_payment"
  | "copy_confirmation_link"
  | "reopen";

/** Which row actions are valid for a given application status — single source of truth instead of scattering conditionals in the table/menu. */
export function getApplicationRowActions(status: ApplicationStatus): ApplicationRowAction[] {
  switch (status) {
    case "pending_review":
      return ["view", "approve", "waitlist", "reject"];
    case "waitlisted":
      return ["view", "approve", "reject"];
    case "approved_confirmation_required":
      return ["view", "copy_confirmation_link", "change_price", "waive_payment", "cancel_approval"];
    case "rejected":
      return ["view", "reopen"];
    case "completed_enrolled":
      return ["view"];
    case "cancelled":
    default:
      return ["view"];
  }
}
