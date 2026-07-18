// Parent/student-facing action semantics for an enrollment request, layered on
// top of the shared status engine in ./applications.ts. Kept separate from
// that file because these labels/destinations are applicant-facing (what a
// parent/student should click next), not the director row-action list.

import type { ApplicationPaymentStatus, ApplicationStatus } from "@/lib/programs/applications";

export function isApplicationActionRequired(status: ApplicationStatus): boolean {
  return status === "approved_confirmation_required";
}

export type ApplicantActionKind = "confirmation" | "class" | "details";

export type ApplicantPrimaryAction = {
  label: string;
  kind: ApplicantActionKind;
};

/** What should the applicant's primary button say, and where should it go? */
export function getApplicantPrimaryAction(
  status: ApplicationStatus,
  paymentStatus: ApplicationPaymentStatus,
  request: { payment_type?: string | null } | null | undefined,
): ApplicantPrimaryAction {
  if (status === "approved_confirmation_required") {
    if (paymentStatus === "not_required" || paymentStatus === "waived") {
      return { label: "Confirm Registration", kind: "confirmation" };
    }
    if (request?.payment_type === "annual") {
      return { label: "Pay in Full", kind: "confirmation" };
    }
    if (paymentStatus === "payment_required" || paymentStatus === "checkout_pending") {
      return { label: "Start Subscription", kind: "confirmation" };
    }
    return { label: "Complete Registration", kind: "confirmation" };
  }
  if (status === "completed_enrolled") {
    return { label: "View Class", kind: "class" };
  }
  return { label: "View Details", kind: "details" };
}
