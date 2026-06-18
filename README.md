# Tareeqah

A white-label platform that lets mosques and Islamic schools run their own branded "masjid app" for managing Quran students. Each organization gets its own tenant portal where students can browse programs, enroll, and pay — while teachers and admins manage classes, rosters, and announcements.

Think of it like this: a student downloads/visits the "As-Siddiq app" (or any mosque's portal), enrolls in a Quran memorization course, pays their tuition, and sees their class schedule. Meanwhile, the teacher sees who's in their class, posts announcements, and manages their roster. The mosque admin oversees everything.

## How It Works

Tareeqah is a **multi-tenant** application. Each mosque gets its own URL namespace (`/m/{slug}`) with its own branding (logo, colors, welcome message). All mosques share the same codebase and database, isolated by tenant.

### User Roles

| Role | What they can do |
|------|-----------------|
| **Student** | Browse programs, apply/enroll, pay for courses, view schedule & announcements |
| **Teacher** | View assigned classes, see student roster, post announcements, review applications |
| **Mosque Admin** | Manage all programs, assign teachers, view enrollment stats, configure mosque settings |
| **Platform Admin** | Global administration across all mosques |

### Core Features

- **Mosque Directory** — Root page lists all registered mosques
- **Program Catalog** — Each mosque lists its active programs (Quran, Arabic, etc.) with details like schedule, price, teacher, and audience
- **Enrollment** — Students enroll in free programs instantly; paid programs go through Stripe checkout
- **Applications** — Students apply to programs; teachers review and approve/reject
- **Scheduling** — Programs have weekly schedules with timezone support; students see upcoming sessions and a calendar view
- **Announcements** — Teachers post updates to their class feed
- **Dashboards** — Role-specific dashboards showing stats (class count, student count, etc.)
- **Payments** — Stripe integration for paid programs with monthly subscriptions
- **Branding** — Each mosque can set its own logo, primary/secondary colors, and welcome message

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Server Components, Server Actions) |
| Language | TypeScript |
| Database & Auth | [Supabase](https://supabase.com) (PostgreSQL + Row Level Security + Auth) |
| Payments | [Stripe](https://stripe.com) (subscriptions, checkout) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| Fonts | [Geist](https://vercel.com/font) (Sans + Mono) |
| Deployment | [Netlify](https://netlify.com) |

## Project Structure

```
app/
  page.tsx                    # Mosque directory (root)
  layout.tsx                  # Root layout
  actions/                    # Server Actions
    auth.ts                   # Login, signup, logout
    programs.ts               # Create/update programs
    enrollments.ts            # Enroll/withdraw
    announcements.ts          # Post announcements
    applications.ts           # Apply, approve, reject
    profile.ts                # Update profile
  api/                        # API routes (webhooks, etc.)
  m/[slug]/                   # Tenant routes (per-mosque)
    page.tsx                  # Mosque home / welcome
    layout.tsx                # Tenant layout with nav
    login/                    # Mosque-scoped login
    signup/                   # Mosque-scoped signup
    programs/                 # Browse & view programs
    dashboard/                # Student dashboard
    classes/                  # Student enrolled classes
    settings/                 # User settings
    teacher/                  # Teacher views
    admin/                    # Mosque admin views
    students/                 # Student management
components/
  ui/                         # Reusable UI components (Button, CardAction, etc.)
  dashboard/                  # Dashboard-specific components
  programs/                   # Program-specific components
  BottomNav.tsx               # Mobile bottom navigation
lib/
  supabase/
    server.ts                 # Supabase server client
    client.ts                 # Supabase browser client
    queries.ts                # All database queries
  billing.ts                  # Payment/subscription helpers
  schedule.ts                 # Schedule parsing, formatting, calendar
  tenants.ts                  # Tenant resolution (slug -> mosque)
types/
  database.ts                 # Supabase database types
```

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (for paid programs)

### Setup

1. **Clone the repo**
   ```bash
   git clone git@github.com:awsolim/tareeqah.git
   cd tareeqah
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy the example file and fill in your values:
   ```bash
   cp .env.example .env.local
   ```

   See [`.env.example`](.env.example) for the full list of variables and where
   each one comes from (Supabase project settings, Stripe dashboard, etc.).

4. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

### Database

The database schema lives in Supabase. Key tables:

- `profiles` — User profiles (linked to Supabase Auth)
- `mosques` — Tenant organizations with branding
- `mosque_memberships` — Role assignments (student, teacher, mosque_admin)
- `programs` — Courses/classes offered by a mosque
- `enrollments` — Student-to-program relationships
- `program_applications` — Application flow for programs
- `program_announcements` — Teacher announcements per program
- `program_subscriptions` — Stripe subscription tracking

### Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Student | student1@gmail.com | student |
| Student | student2@gmail.com | student |
| Teacher / Mosque Admin | teacher1@gmail.com | teacher |
| Teacher | teacher2@gmail.com | teacher |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Deployment

The app deploys to [Netlify](https://netlify.com) via the
[`@netlify/plugin-nextjs`](https://github.com/netlify/next-runtime) plugin.
Build settings live in [`netlify.toml`](netlify.toml).

The simplest path is to connect the GitHub repo to a Netlify site for automatic
deployments on push. Set the environment variables from `.env.example` in the
site's **Site settings → Environment variables**.

For manual/preview deploys with the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
netlify deploy          # preview deploy
netlify deploy --prod   # production deploy
```

## License

Private repository. All rights reserved.
