<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tareeqah Project Instructions

Tareeqah is a white-label masjid education/class management platform.

The app is mobile-first but desktop must also be polished. The UI should feel like operational class-management software, not generic SaaS dashboard cards.

## Important safety rules

- Do not run destructive database commands.
- Do not run `supabase db push` unless explicitly asked.
- Do not directly modify production Supabase.
- Do not drop tables or columns unless explicitly approved.
- Use non-destructive Supabase migrations.
- Preserve existing auth, RLS, public routes, teacher routes, parent portal routes, and admin routes.
- Prefer small, reviewable changes.
- Run typecheck/build after significant changes.
- If schema is ambiguous, inspect existing tables and adapt rather than duplicating concepts.
- For the program builder upgrade, continue from the current WIP state rather than rewriting everything from scratch.
- Before editing major files, inspect the current implementation and summarize the plan.
- Do not use heavy gradients, generic SaaS card overload, or excessive shadows.
- Keep the UI clean, structured, mobile-first, and operational.

## Database rules

- Do not disable RLS globally.
- Do not create duplicate tables for concepts that already exist unless clearly necessary.
- Reuse existing tables where appropriate.
- Add columns/tables only through migrations.
- Use `create table if not exists` and `alter table add column if not exists` where possible.
- Do not run migrations against production unless explicitly approved.
- Do not run `supabase db reset`, especially not with `--linked`.

## Program builder context

The new program builder should eventually support:

- multi-step wizard
- drafts
- preview
- publish
- published but not accepting applications
- hidden/private programs
- one-time events
- recurring programs
- tracks/sections
- weekly schedules
- custom session dates
- free/monthly/one-time/manual pricing
- custom prices and waived payments during Director review
- Director and Instructor roles assigned per program/section, not globally