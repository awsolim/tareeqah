export type ProgramLike = {
  is_paid?: boolean | null;
};

export type ProgramSubscriptionLike = {
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

export function isProgramPaid(program: ProgramLike | null | undefined) {
  return Boolean(program?.is_paid);
}

export function isSubscriptionActive(
  subscription: ProgramSubscriptionLike | null | undefined
) {
  if (!subscription) {
    return false;
  }

  return subscription.status === "active";
}

export function canStudentAccessProgram(options: {
  program: ProgramLike | null | undefined;
  isEnrolled: boolean;
  subscription?: ProgramSubscriptionLike | null;
  paymentWaived?: boolean;
}) {
  const { program, isEnrolled, subscription, paymentWaived } = options;

  if (!isEnrolled) {
    return false;
  }

  if (!isProgramPaid(program)) {
    return true;
  }

  if (paymentWaived) {
    return true;
  }

  return isSubscriptionActive(subscription);
}