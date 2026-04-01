import { redirect, notFound } from "next/navigation";
import {
  getCachedMosqueBySlug,
  getCachedMembership,
  getCachedProfile,
} from "@/lib/supabase/cached-queries";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { CompleteSignupForm } from "./CompleteSignupForm";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CompleteSignupPage({ params }: PageProps) {
  const { slug } = await params;
  const mosque = await getCachedMosqueBySlug(slug);
  if (!mosque) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated — redirect to login
  if (!user) {
    redirect(`/m/${slug}/login`);
  }

  // Already has a membership — skip to dashboard
  const membership = await getCachedMembership(user.id, mosque.id);
  if (membership) {
    redirect(`/m/${slug}/dashboard`);
  }

  // Get profile data (name / email pre-filled from Google)
  const profile = await getCachedProfile();
  const fullName = profile?.full_name ?? "";
  const email = user.email ?? "";
  const primaryColor = mosque.primary_color ?? "#000000";

  const leftContent = (
    <>
      <div className="space-y-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Almost There
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Complete Your Signup
        </h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ve signed in with Google. Now choose how you&apos;d like to
          join {mosque.name}.
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{mosque.name}</p>
        <p className="text-xs text-muted-foreground">
          Empowering spiritual education
        </p>
      </div>
    </>
  );

  return (
    <AuthLayout mosque={mosque} leftContent={leftContent}>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Complete Your Signup
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm your details and choose your role at {mosque.name}.
          </p>
        </div>

        <CompleteSignupForm
          slug={slug}
          mosqueId={mosque.id}
          fullName={fullName}
          email={email}
          primaryColor={primaryColor}
        />
      </div>
    </AuthLayout>
  );
}
