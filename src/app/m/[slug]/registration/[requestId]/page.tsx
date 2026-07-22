import { RegistrationConfirmationPage } from "@/components/pages/page-views";

function safeReturnTo(value: string | string[] | undefined, slug: string) {
  const returnTo = Array.isArray(value) ? value[0] : value;
  if (!returnTo) {
    return undefined;
  }

  const allowedPrefixes = [`/m/${slug}/admin/`, `/m/${slug}/teacher/`, `/m/${slug}/portal/`, `/m/${slug}/programs`];
  return allowedPrefixes.some((prefix) => returnTo === prefix.slice(0, -1) || returnTo.startsWith(prefix)) ? returnTo : undefined;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; requestId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { slug, requestId } = await params;
  const query = await searchParams;
  return <RegistrationConfirmationPage slug={slug} requestId={requestId} returnTo={safeReturnTo(query.returnTo, slug)} />;
}
