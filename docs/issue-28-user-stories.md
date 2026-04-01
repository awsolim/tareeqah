## Summary

Allow admins or teachers to waive payment requirements for a student, enrolling them in a paid program without charging them.

## Context

Sometimes a student can't afford tuition but the masjid wants them enrolled anyway. Currently there's no way to bypass the payment requirement for a paid program — the student must go through Stripe checkout. An admin or teacher should be able to "forgive" the payment and directly enroll the student.

Distinct from sponsored students (issue #27) — this is a mosque-side administrative decision, not a donor payment.

---

## User Stories

### US-W1: Admin waives payment for an accepted application
**As a** mosque admin,
**I want to** waive payment for a student's accepted application to a paid program,
**so that** the student can enroll without going through Stripe checkout.

**Acceptance criteria:**
- A "Waive Payment" button appears on the teacher/admin dashboard next to accepted applications for **paid** programs only
- Clicking "Waive Payment" creates an enrollment with `payment_waived=true`, `waived_by` set to the admin's profile ID, and `waived_at` set to the current timestamp
- The application status is updated to "joined"
- The student is immediately enrolled and can access the program
- No Stripe checkout session or subscription is created

### US-W2: Teacher (with can_manage_programs) waives payment
**As a** teacher with `can_manage_programs` permission,
**I want to** waive payment for a student's accepted application in my program,
**so that** I can grant access to deserving students without involving the admin.

**Acceptance criteria:**
- Teacher sees the same "Waive Payment" button on their dashboard for accepted applications to their paid programs
- Permission check: teacher must have `can_manage_programs=true` in their mosque membership
- The waiver is recorded with the teacher's profile ID as `waived_by`

### US-W3: Waived student gets full program access
**As a** student whose payment was waived,
**I want to** be automatically enrolled and access the program like any paying student,
**so that** I am not treated differently from other enrolled students.

**Acceptance criteria:**
- `canStudentAccessProgram()` returns `true` when `payment_waived=true`, even without an active Stripe subscription
- Student sees "Enrolled" badge and "Go to Class" link on the program detail page
- Student's dashboard shows the program in "My Enrollments"
- Student does NOT see any "payment waived" indicator (the waiver is admin-visible only)

### US-W4: Audit trail for waived payments
**As a** mosque admin,
**I want to** see which students have waived payments, and who approved each waiver,
**so that** I have accountability and can track financial forgiveness.

**Acceptance criteria:**
- On the admin program detail page, enrolled students with waivers show a "Waived" badge
- The "Waived" badge or tooltip shows who waived it (the approver's name)
- The `waived_at` timestamp is stored for record-keeping

### US-W5: Revoking a payment waiver
**As a** mosque admin,
**I want to** revoke a payment waiver, which removes the student's enrollment,
**so that** I can correct mistakes or require the student to pay if circumstances change.

**Acceptance criteria:**
- A "Revoke Waiver" button appears next to waived enrollments on the admin program detail page
- Only mosque admins can revoke waivers (not teachers)
- Revoking deletes the enrollment and sets the application status back to "accepted"
- The student would then need to pay via Stripe checkout or receive another waiver to re-enroll

---

## Edge Cases

| Scenario | Expected behavior |
|---|---|
| Student already has an active Stripe subscription | "Waive Payment" button does not appear (waiver not needed — student is already paying) |
| Application is still pending (not accepted) | "Waive Payment" button does not appear (must be accepted first) |
| Program is free | "Waive Payment" button does not appear (not applicable) |
| Student is already enrolled | "Waive Payment" button does not appear |
| Student was rejected, re-accepted, then waived | Works normally — waiver applies to the current accepted application |
| Double-click on "Waive Payment" | Idempotent — checks for existing enrollment before creating |
| Student cannot waive their own payment | Server action validates caller is admin or teacher |
| Parent cannot waive payment | Server action validates caller role |

---

## Data Model

Add columns to the `enrollments` table (simpler than a separate table since waiver is 1:1 with enrollment):

```sql
ALTER TABLE enrollments ADD COLUMN payment_waived boolean NOT NULL DEFAULT false;
ALTER TABLE enrollments ADD COLUMN waived_by uuid REFERENCES profiles(id);
ALTER TABLE enrollments ADD COLUMN waived_at timestamptz;
```

No RLS changes needed — enrollments already have appropriate policies for admin/teacher insert.

---

## Implementation Plan

### Server actions (`app/actions/waivers.ts`)
- `waivePayment(formData)` — validates permissions, creates enrollment with waiver fields, updates application to "joined"
- `revokeWaiver(formData)` — validates admin role, deletes enrollment, resets application to "accepted"

### Billing logic (`lib/billing.ts`)
- Update `canStudentAccessProgram()` to accept `paymentWaived` parameter and return `true` when waived

### Queries (`lib/supabase/queries.ts`)
- Update `getEnrollmentsForProgramInAdminView()` to include `payment_waived`, `waived_by`, and waiver approver's name

### UI changes
- Dashboard: "Waive Payment" button on accepted applications for paid programs
- Admin program detail: "Waived" badge on waived enrollments, "Revoke Waiver" button
- No changes to student-facing UI (waivers are invisible to students)
- No changes to Stripe webhook or checkout flow
