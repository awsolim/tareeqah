import { RegistrationConfirmationPage } from "@/components/pages/page-views";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; requestId: string }>;
}) {
  const { slug, requestId } = await params;
  return <RegistrationConfirmationPage slug={slug} requestId={requestId} />;
}
