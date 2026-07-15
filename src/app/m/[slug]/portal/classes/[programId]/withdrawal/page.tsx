import { PortalWithdrawalRequestPage } from "@/components/pages/page-views";

export default async function Page({ params }: { params: Promise<{ slug: string; programId: string }> }) {
  const { slug, programId } = await params;
  return <PortalWithdrawalRequestPage slug={slug} programId={programId} />;
}
