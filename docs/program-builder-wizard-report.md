# Program Builder Wizard Report

## Current Structure Found

The app already had most of the program model in place:

- `programs` stores the class identity, legacy active/paid flags, image, audience, price, schedule summary, track selection rule, and Stripe price IDs.
- `program_details`, `program_outcomes`, `program_content_sections`, `program_faqs`, and `program_media` already support public page content.
- `program_tracks` already supports class tracks/sections and is linked to enrollment requests, enrollments, and subscriptions through join tables.
- `program_teachers` already supports assignment-specific `director` and `instructor` roles for a program.
- `enrollment_requests`, `enrollments`, and `program_subscriptions` already support applications, admitted students, payment type, and Stripe subscription/checkout records.
- There was no actual session table for dated meetings, only `program_session_cancellations`.

## Migration Strategy

The migration is intentionally non-destructive. It extends existing tables instead of creating a competing builder schema.

- Extended `programs` with builder/publication/application/lifecycle/pricing/contact fields.
- Extended `program_tracks` with optional audience, capacity, location, room, and track-specific pricing fields.
- Extended `program_details` with requirements, what-to-bring, policies, and topics text fields.
- Added `program_sessions` because actual dated sessions did not exist.
- Added indexes and RLS policies using the existing `can_manage_program` helper.

No existing tables or columns were dropped.

## Implemented

- Added migration: `supabase/migrations/20260714150500_program_builder_wizard.sql`.
- Updated Supabase local TypeScript types for the new columns and `program_sessions`.
- Extended `/api/programs/create` and `/api/programs/[programId]` so create/update can save:
  - draft/published/hidden/archive status
  - application status and mode
  - capacity behavior and waitlist settings
  - payment kind and review-time custom price/waiver settings
  - public summary/category/contact/receipt/financial assistance fields
- Draft saves can be incomplete. Publish saves validate the important public and payment fields.
- Added a five-step builder frame to the add-class flow:
  - Basics
  - Public Page
  - Schedule
  - Pricing
  - Review
- Added Save Draft, Back, Next, Preview, and Publish-style footer behavior for the add-class builder.
- Split the add-class builder into step-specific sections so create no longer shows the old all-in-one form.
- Persisted public-page detail fields for topics, requirements, what to bring, and policies.
- Rendered public-page detail fields on the actual public program page.
- Added program duration fields, schedule pattern, registration deadline, location, room, and billing-start behavior.
- Added create-builder controls for one-time events, recurring duration, weekly/custom-date schedules, registration deadline, location, room, and monthly billing behavior.
- Added track-level capacity controls while keeping pricing at the program level.
- Changed new programs to default to ongoing duration.
- Removed the fixed-date-range duration option from the create builder path.
- Added a Start Now checkbox that disables the start date and stores `start_now`.
- Added estimated end-month helper text for fixed-month durations.
- Changed the mobile builder stepper to fixed numbered steps instead of a horizontally scrolling label row.
- Changed Save Draft to a filled blue action.
- Removed the duplicate paid/free decision in the create pricing flow. Payment kind is now the source of truth: Free, Paid through Tareeqah, or Manual/outside payment.
- Scoped the manual payment note to manual/outside payment only. It is intended for payment instructions handled outside Tareeqah, such as office payment or e-transfer notes.
- Added monthly cycle helper text and one-time annual savings comparison text.
- Reworked tags into multiple independent tag entries instead of a single category text field in the create builder.
- Reordered Basics so internal name and public name are consecutive.
- Added visual required asterisks to likely publish-required fields without adding new enforcement yet.
- Flattened the shared create form layout so desktop sections stack top-to-bottom instead of using side-by-side cards.
- Refined the learning outcomes and track builder rows into more structured operational editing modules.
- Default program location now uses the masjid name and, when the schema provides it, the masjid address.
- Made the builder stepper display-only; navigation happens through Back/Continue.
- Simplified learning outcomes so outcome points appear directly after the learning section description.
- Removed the delete-learning-section action and changed Add Point to an icon-only plus action.
- Changed default capacity label to Capacity with a compact number input and "students" label.
- New programs no longer default to all ages.
- Start Now and No Registration Deadline now use full label-click checkbox rows and disabled fields show plain text values.
- Removed per-track location and room fields from the track builder.
- Tightened track session time rows so they fit inside the track module on mobile.
- Application-mode controls now hide "Accepting applications now" unless the mode is Application Required.
- Billing start label now says "On first payment".
- Ongoing programs no longer show "On program end date" as a billing end option.
- Fixed-month program duration seeds billing duration months.
- Persisted a first `program_sessions` row for one-time event schedules when an event date is provided.
- Persisted `program_sessions` rows for custom dated recurring sessions.
- Updated public program listing visibility so draft, cancelled, and archived programs do not appear in the public list.
- Updated public program detail enrollment availability to use the new application status/date fields.
- Replaced the add-builder footer with three actions: Save Draft, Back, Continue/Publish.
- Changed the Review step into an in-wizard public-page preview instead of a summary plus a separate preview action.
- Removed Basics-level capacity from the create builder. Capacity is now configured per track only, using a compact number input with a `students` label.
- Changed short summary/tagline and instructor credentials to one-line inputs in the create builder.
- Collapsed the learning section description behind an optional `Add section description` action.
- New learning sections now start with three default outcome rows: `Learning outcome #1`, `Learning outcome #2`, and `Learning outcome #3`.
- Changed the add-outcome control to a circular bordered plus icon.
- Widened track session start/end time controls so the dropdown affordance does not cover the time text.
- Removed the visible custom-price and waived-payment toggles from the create builder; those remain enabled by default for review workflows.
- Renamed the billing fixed-month input to `Number of months in billing cycle` and left it empty by default for new programs.
- Public pricing now shows a savings badge on whichever option is cheaper, including monthly when monthly is cheaper than the one-time annual option.
- The create schedule step now labels the first recurring duration control `Duration Type`.
- One-time events now skip recurring duration and track-builder controls, using event date plus optional start/end time instead.
- Custom session-date schedules now show a session adder instead of the full track builder.
- Room now starts collapsed behind `Add room` under the location field.
- The admin Masjid action list now includes `Masjid Information`.
- Replaced the edit-class screen with the five-step builder flow and removed the legacy one-page editor sections, old preview button, delete panel, and unsaved-change serializer.
- Edit saves now persist the newer builder fields, including schedule/date settings, public-page details, track capacity fields, and generated `program_sessions`.
- Admin-selected directors now autofill instructor display name, credentials, contact phone, and contact email from the selected teacher profile in the builder flow.
- Added contact email to the instructor display/contact section.
- Preserved the existing media, FAQ, track, price, Stripe, and director assignment plumbing instead of replacing those working paths.
- Removed per-track pricing from the app surface; tracks now save pricing overrides as disabled/null and program pricing is the only price source.

## Verification

- Ran `npx tsc --noEmit`.
- Typecheck passed.

## Follow-Ups

This pass sets up the compatible builder data model and create-program wizard. The remaining deeper work is:

- Visually check the edit builder in-browser against the create builder and tighten any remaining spacing/copy differences.
- Add a dedicated preview route for draft/hidden programs.
- Add richer validation UI on the Review step.
- Render `program_sessions` as first-class dated meetings in schedule/attendance views.
- Add section-level director/instructor assignments if the product needs permissions below the program level.
